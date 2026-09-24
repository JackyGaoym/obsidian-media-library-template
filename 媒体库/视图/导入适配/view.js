// Keep QuickAdd compatibility checks separate from type definitions and theme state.
if (!window.__mediaLibraryImportAdapter || window.__mediaLibraryImportAdapter.version !== 3) {
  const showNotice = message => {
    try {
      const NoticeClass = typeof require === "function" ? require("obsidian").Notice : null;
      if (NoticeClass) new NoticeClass(message);
    } catch (error) {
      console.error(message, error);
    }
  };
  const isMobile = app => Boolean(app.isMobile
    || (typeof document !== "undefined" && document.body?.classList.contains("is-mobile")));
  const openMobileChoicePicker = (app, type, quickAdd, options = {}) => {
    let children = [];
    let api = null;
    try {
      const choice = quickAdd?.getChoiceById?.(type.quickAddChoiceId);
      children = choice?.choices?.filter(item => item?.name && item.type !== "Multi") || [];
      api = quickAdd?.api;
    } catch (error) {
      console.error(`无法读取新增${type.label}的 QuickAdd 选项`, error);
    }
    const executeChoice = api?.executeChoice;
    let ModalClass = null;
    let setIcon = null;
    try {
      const obsidian = typeof require === "function" ? require("obsidian") : null;
      ModalClass = obsidian?.Modal;
      setIcon = obsidian?.setIcon;
    } catch (error) {
      console.error("无法加载手机端新增菜单", error);
    }
    if ((!ModalClass && !options.modal) || typeof executeChoice !== "function" || children.length === 0) {
      showNotice(`无法打开新增${type.label}菜单，请确认 QuickAdd 已启用并重新加载插件`);
      return false;
    }
    const renderChoices = modal => {
      modal.titleEl.setText(`新增${type.label}`);
      modal.contentEl.empty();
      const shell = modal.contentEl.createDiv({ cls: "media-type-picker" });
      if (options.onBack) {
        const back = shell.createEl("button", {
          cls: "media-type-manage-button",
          text: "← 选择其他类别",
          attr: { type: "button" }
        });
        back.addEventListener("click", options.onBack);
      }
      shell.createDiv({ cls: "media-type-modal-intro", text: "选择导入方式" });
      const grid = shell.createDiv({ cls: "media-type-picker-grid" });
      for (const child of children) {
        const button = grid.createEl("button", {
          cls: `media-type-picker-card is-${type.id}`,
          attr: { type: "button", "aria-label": child.name }
        });
        const icon = button.createSpan({ cls: "media-type-picker-icon" });
        try {
          if (setIcon && child.icon) setIcon(icon, child.icon);
          else icon.setText(child.type === "Template" ? "✎" : "↓");
        } catch (error) {
          icon.setText(child.type === "Template" ? "✎" : "↓");
        }
        const copy = button.createSpan({ cls: "media-type-picker-copy" });
        copy.createEl("strong", { text: child.name });
        copy.createSpan({ text: child.type === "Template" ? "手动填写作品信息" : "自动搜索并导入条目信息" });
        button.addEventListener("click", () => {
          modal.close();
          window.setTimeout(() => {
            Promise.resolve(executeChoice.call(api, child.name)).catch(error => {
              console.error(`无法执行${child.name}`, error);
              showNotice(`无法执行${child.name}，请检查 QuickAdd 配置`);
            });
          }, 80);
        });
      }
    };
    if (options.modal) {
      renderChoices(options.modal);
      return true;
    }
    class MobileChoiceModal extends ModalClass {
      onOpen() {
        this.modalEl.addClass("media-type-picker-modal");
        renderChoices(this);
      }
      onClose() {
        this.contentEl.empty();
      }
    }
    new MobileChoiceModal(app).open();
    return true;
  };
  const launch = async (app, type, allTypes, options = {}) => {
    if (!type?.quickAddChoiceId) return false;
    if (type.flexibleFormat) {
      try {
        const quickAdd = app.plugins?.plugins?.quickadd;
        let changed = false;
        for (const flexibleType of allTypes.filter(item => item.flexibleFormat)) {
          const choice = quickAdd?.getChoiceById?.(flexibleType.quickAddChoiceId);
          const importChoice = choice?.choices?.find(item => item.name === `豆瓣导入${flexibleType.label}`);
          const command = importChoice?.macro?.commands?.[0];
          if (command?.type !== "Obsidian"
            || command.commandId !== "obsidian-douban-plugin:searcher-douban-import-and-create-file-movie-tv") continue;
          command.type = "UserScript";
          command.path = "媒体库/视图/主题/豆瓣分类导入.js";
          command.name = `豆瓣分类导入::${flexibleType.id}`;
          command.settings = {};
          delete command.commandId;
          changed = true;
        }
        if (changed) await quickAdd.saveSettings?.();
      } catch (error) {
        console.error("无法更新综艺和纪录片的豆瓣导入入口", error);
      }
    }
    if (isMobile(app)) return openMobileChoicePicker(app, type, app.plugins?.plugins?.quickadd, options);
    const commandId = `quickadd:choice:${type.quickAddChoiceId}`;
    if (!app.commands.findCommand?.(commandId)) {
      try {
        const quickAdd = app.plugins?.plugins?.quickadd;
        if (quickAdd?.getChoiceById && quickAdd?.addCommandForChoice) {
          const choice = quickAdd.getChoiceById(type.quickAddChoiceId);
          if (choice) quickAdd.addCommandForChoice(choice);
        }
      } catch (error) {
        console.error(`无法加载${type.label}的 QuickAdd 入口`, error);
      }
    }
    if (!app.commands.findCommand?.(commandId)) {
      showNotice(`无法打开“新增${type.label}”，请确认 QuickAdd 已启用并重新加载插件`);
      return false;
    }
    return app.commands.executeCommandById(commandId);
  };
  window.__mediaLibraryImportAdapter = { version: 3, launch };
}
