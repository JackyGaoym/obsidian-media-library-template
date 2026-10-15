// Import-only preflight. The recipe never stores or restores authentication data.
if (!window.__mediaLibraryDoubanConfig || window.__mediaLibraryDoubanConfig.version !== 1) {
  const CONFIG_PATH = "媒体库/配置/豆瓣导入.json";
  const labels = Object.freeze({
    bookTemplateFile: "图书模板", movieTemplateFile: "电影模板", teleplayTemplateFile: "电视剧模板",
    gameTemplateFile: "游戏模板", musicTemplateFile: "音乐模板", dataFilePath: "作品保存目录",
    dataFileNamePath: "作品命名规则", attachmentPath: "封面保存目录", attachmentFileName: "封面命名规则",
    cacheImage: "封面本地缓存", cacheHighQuantityImage: "高清封面缓存", dateFormat: "日期格式"
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const pending = new WeakMap();
  const validate = recipe => {
    if (recipe?.version !== 1 || !recipe.settings || Array.isArray(recipe.settings)) {
      throw new Error("豆瓣导入配置格式无效，请更新媒体库/配置/豆瓣导入.json");
    }
    const keys = Object.keys(recipe.settings);
    if (keys.length !== Object.keys(labels).length || keys.some(key => !Object.hasOwn(labels, key))) {
      throw new Error("恢复配置只能包含媒体库所需的路径、缓存与日期格式");
    }
    for (const key of keys) {
      const expectedType = key === "cacheImage" || key === "cacheHighQuantityImage" ? "boolean" : "string";
      if (typeof recipe.settings[key] !== expectedType) throw new Error(`${labels[key]}的格式无效`);
    }
    const array = recipe.arraySettings;
    const properties = recipe.customProperties;
    if (!Array.isArray(array) || array.length !== 1 || array[0]?.arrayName !== "ArrayTypeYaml"
      || !Array.isArray(properties) || properties.length !== 1
      || properties[0]?.name !== "coverLink" || properties[0]?.field !== "all") {
      throw new Error("豆瓣模板的列表格式或封面变量配置无效");
    }
    if (["arrayStart", "arrayElementStart", "arraySpiltV2", "arrayElementEnd", "arrayEnd"].some(key => typeof array[0][key] !== "string")
      || !Number.isInteger(array[0].index) || typeof properties[0].value !== "string") {
      throw new Error("豆瓣模板的列表格式或封面变量配置无效");
    }
    return recipe;
  };
  const plan = (settings, recipe) => {
    validate(recipe);
    const changes = [];
    for (const [key, value] of Object.entries(recipe.settings)) {
      if (!same(settings[key], value)) changes.push({ key, label: labels[key], value: clone(value) });
    }
    for (const [key, label, matches] of [
      ["arraySettings", "模板专用 YAML 列表格式", item => item?.arrayName === "ArrayTypeYaml"],
      ["customProperties", "模板专用封面链接变量", item => item?.name === "coverLink" && item?.field === "all"]
    ]) {
      const current = Array.isArray(settings[key]) ? settings[key] : [];
      const owned = current.filter(matches);
      const desired = recipe[key][0];
      if (owned.length === 1 && Object.entries(desired).every(([name, value]) => same(owned[0][name], value))) continue;
      const replacement = { ...(owned[0] || {}), ...clone(desired) };
      changes.push({ key, label, value: [...current.filter(item => !matches(item)), replacement] });
    }
    return changes;
  };
  const confirm = (app, obsidian, changes) => new Promise(resolve => {
    if (!obsidian?.Modal) { resolve(false); return; }
    let confirmed = false;
    class RestoreModal extends obsidian.Modal {
      onOpen() {
        this.modalEl.addClass("media-metadata-editor-modal", "media-douban-config-modal");
        this.titleEl.setText("恢复豆瓣导入配置");
        this.contentEl.createEl("p", { text: "检测到媒体库导入配置缺失或与模板要求不同。是否恢复以下项目？" });
        const list = this.contentEl.createEl("ul");
        for (const change of changes) list.createEl("li", { text: change.label });
        this.contentEl.createEl("p", {
          cls: "media-delete-help",
          text: "只调整以上媒体库配置，保留登录信息和其他自定义设置。取消则不修改配置，也不开始本次导入；重新安装插件后仍需自行登录豆瓣。"
        });
        const actions = this.contentEl.createDiv({ cls: "media-delete-actions" });
        actions.createEl("button", { text: "取消", attr: { type: "button" } })
          .addEventListener("click", () => this.close());
        actions.createEl("button", { text: "恢复并继续", cls: "mod-cta", attr: { type: "button" } })
          .addEventListener("click", () => { confirmed = true; this.close(); });
      }
      onClose() { this.contentEl.empty(); resolve(confirmed); }
    }
    new RestoreModal(app).open();
  });
  const notice = (obsidian, message) => {
    if (obsidian?.Notice) new obsidian.Notice(message);
    else console.warn(message);
  };
  const ensure = async (app, obsidian) => {
    const plugin = app.plugins?.plugins?.["obsidian-douban-plugin"];
    if (!plugin?.settings || typeof plugin.saveSettings !== "function") {
      notice(obsidian, "请先安装并启用豆瓣插件，再使用豆瓣导入");
      return false;
    }
    // A second click waits for the same confirmation instead of opening another modal.
    if (pending.has(plugin)) { await pending.get(plugin); return false; }
    const task = (async () => {
      try {
        const configFile = app.vault.getAbstractFileByPath(CONFIG_PATH);
        if (!configFile || configFile.extension !== "json") throw new Error(`缺少 ${CONFIG_PATH}，请补齐模板配置文件`);
        const recipe = validate(JSON.parse(await app.vault.read(configFile)));
        for (const [key, path] of Object.entries(recipe.settings)) {
          if (!key.endsWith("TemplateFile")) continue;
          const file = app.vault.getAbstractFileByPath(path);
          if (!file || file.extension !== "md") throw new Error(`找不到${labels[key]}：${path}，请先补齐模板文件`);
        }
        const settings = plugin.settings;
        const changes = plan(settings, recipe);
        if (!changes.length) return true;
        const before = changes.map(change => ({ key: change.key,
          exists: Object.hasOwn(settings, change.key), value: settings[change.key], fingerprint: JSON.stringify(settings[change.key]) }));
        if (!await confirm(app, obsidian, changes)) return false;
        if (app.plugins?.plugins?.["obsidian-douban-plugin"] !== plugin || plugin.settings !== settings
          || before.some(item => JSON.stringify(settings[item.key]) !== item.fingerprint)) {
          throw new Error("豆瓣配置在确认期间发生变化，请重新点击导入");
        }
        for (const change of changes) settings[change.key] = change.value;
        try {
          await plugin.saveSettings();
        } catch (error) {
          // Restore only fields still holding this attempt's values; don't undo later user edits.
          for (const item of before) {
            const change = changes.find(change => change.key === item.key);
            if (!same(settings[item.key], change.value)) continue;
            if (item.exists) settings[item.key] = item.value;
            else delete settings[item.key];
          }
          throw new Error("豆瓣配置保存失败，未开始导入，请重试");
        }
        if (app.plugins?.plugins?.["obsidian-douban-plugin"] !== plugin || plugin.settings !== settings) {
          throw new Error("豆瓣插件状态发生变化，请重新点击导入");
        }
        notice(obsidian, "媒体库豆瓣导入配置已恢复；如尚未登录，请先在豆瓣插件中登录");
        return true;
      } catch (error) {
        // Never log the plugin settings object: it can contain cookies and headers.
        notice(obsidian, error instanceof SyntaxError ? "豆瓣导入配置不是有效 JSON，请检查配置文件" : String(error.message || "豆瓣配置检查失败"));
        return false;
      }
    })();
    pending.set(plugin, task);
    try { return await task; } finally { if (pending.get(plugin) === task) pending.delete(plugin); }
  };
  window.__mediaLibraryDoubanConfig = { version: 1, ensure, plan };
}
