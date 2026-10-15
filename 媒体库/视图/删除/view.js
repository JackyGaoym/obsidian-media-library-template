// Deletion is explicit, scoped to library notes, and always uses the vault trash.
if (!window.__mediaLibraryDeletion || window.__mediaLibraryDeletion.version !== 2) {
  const busy = new Set();
  const metadata = (app, file) => app.metadataCache.getFileCache(file)?.frontmatter || {};
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const values = value => Array.isArray(value) ? value : value ? [value] : [];
  const pointsTo = (app, value, source, target) => {
    const raw = String(value?.path ?? value ?? "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0];
    if (!raw) return false;
    const resolved = app.metadataCache.getFirstLinkpathDest(raw, source.path);
    return resolved ? resolved.path === target.path : raw.replace(/\.md$/i, "") === target.path.replace(/\.md$/i, "");
  };
  const plan = (app, path) => {
    const file = app.vault.getAbstractFileByPath(path);
    const fm = file && metadata(app, file);
    const work = fm?.note_type === "media" && path.startsWith("媒体库/作品/");
    const group = fm?.note_type === "media_collection" && path.startsWith("媒体库/合集/");
    if (!file || file.extension !== "md" || (!work && !group)) throw new Error("只能删除媒体库中的作品、系列或合集笔记");
    const notes = app.vault.getMarkdownFiles();
    const records = work ? notes.filter(note => note.path.startsWith("媒体库/记录/")
      && metadata(app, note).note_type === "media_experience"
      && pointsTo(app, metadata(app, note).work, note, file)) : [];
    return { file, records, notes, title: String(fm.title || file.basename), kind: work ? "作品" : fm.collection_kind === "series" ? "系列" : "合集" };
  };
  const execute = async (app, path, options = {}) => {
    const vaultName = app.vault.getName();
    if (busy.has(vaultName)) throw new Error("另一项删除正在处理，请稍后再试");
    busy.add(vaultName);
    const writes = [];
    const trashed = [];
    try {
      const current = plan(app, path);
      if (options.expectedRecords && JSON.stringify(current.records.map(file => file.path).sort())
        !== JSON.stringify([...options.expectedRecords].sort())) throw new Error("关联的体验记录已变化，请重新打开删除确认");
      const targets = [...(options.deleteRecords === false ? [] : current.records), current.file];
      const backups = new Map();
      for (const file of targets) backups.set(file.path, await app.vault.read(file));
      const removed = new Set(targets.map(file => file.path));
      const queue = (file, fn) => window.__mediaLibraryDomain.runFileWrite(vaultName, file.path, fn);
      for (const note of current.notes) {
        if (removed.has(note.path) || !note.path.startsWith("媒体库/")) continue;
        if (!["media", "media_collection"].includes(metadata(app, note).note_type)) continue;
        if (!["series", "collections", "related"].some(key => values(metadata(app, note)[key])
          .some(value => pointsTo(app, value, note, current.file)))) continue;
        const entry = { file: note, fields: {} };
        // Register before awaiting: a write may change the file and then fail.
        writes.push(entry);
        await queue(note, () => app.fileManager.processFrontMatter(note, fm => {
          for (const key of ["series", "collections", "related"]) {
            const before = fm[key];
            if (!values(before).some(value => pointsTo(app, value, note, current.file))) continue;
            const after = Array.isArray(before)
              ? before.filter(value => !pointsTo(app, value, note, current.file)) : "";
            entry.fields[key] = { before: clone(before), after: clone(after) };
            fm[key] = after;
          }
        }));
      }
      for (const file of targets) {
        if (app.vault.getAbstractFileByPath(file.path) !== file) throw new Error("笔记已被移动或删除，请刷新后重试");
        await queue(file, async () => {
          const backup = { path: file.path, body: await app.vault.read(file) };
          trashed.push(backup);
          await app.vault.trash(file, false);
        });
      }
      return { kind: current.kind, count: targets.length };
    } catch (error) {
      const failures = [];
      for (const item of [...trashed].reverse()) {
        try {
          if (!app.vault.getAbstractFileByPath(item.path)) await app.vault.create(item.path, item.body);
        } catch (restoreError) { failures.push(item.path); console.error(restoreError); }
      }
      for (const entry of [...writes].reverse()) {
        try {
          await window.__mediaLibraryDomain.runFileWrite(app.vault.getName(), entry.file.path,
            () => app.fileManager.processFrontMatter(entry.file, fm => {
              for (const [key, snapshot] of Object.entries(entry.fields)) {
                if (JSON.stringify(fm[key]) !== JSON.stringify(snapshot.after)) {
                  failures.push(`${entry.file.path} 的 ${key}`);
                  continue;
                }
                fm[key] = clone(snapshot.before);
              }
            }));
        } catch (restoreError) { failures.push(entry.file.path); console.error(restoreError); }
      }
      error.userMessage = failures.length
        ? `删除未完成，请检查自动恢复失败的项目：${failures.join("、")}`
        : `删除未完成，已恢复本次修改：${error.message || error}`;
      throw error;
    } finally { busy.delete(vaultName); }
  };
  const mount = (app, parent, path) => {
    const obsidian = window.__mediaLibraryObsidian;
    if (!obsidian?.Modal || !obsidian?.setIcon) {
      console.error("删除按钮暂不可用：Obsidian 交互接口尚未加载");
      return null;
    }
    const button = parent.createEl("button", {
      cls: "media-entry-delete", attr: { type: "button", "aria-label": "删除并移入回收站" }
    });
    obsidian.setIcon(button, "trash-2");
    if (obsidian.setTooltip) obsidian.setTooltip(button, "删除并移入回收站");
    else button.setAttribute("title", "删除并移入回收站");
    button.addEventListener("click", () => {
      let current;
      try { current = plan(app, path); }
      catch (error) { new obsidian.Notice(error.message); return; }
      class DeleteModal extends obsidian.Modal {
        onOpen() {
          this.modalEl.addClass("media-delete-modal");
          this.titleEl.setText(`删除${current.kind}`);
          this.contentEl.createEl("p", { text: `确定将「${current.title}」移入回收站吗？` });
          this.contentEl.createEl("p", { cls: "media-delete-help", text: current.kind === "作品"
            ? "会清理其他作品中的关联。封面和横幅保留，不会删除可能共用的图片。"
            : "只删除这份系列或合集笔记，并解除相关归属；其中的作品、体验记录和图片都会保留。" });
          let checkbox = null;
          if (current.records.length) {
            const row = this.contentEl.createEl("label", { cls: "media-delete-records" });
            checkbox = row.createEl("input", { attr: { type: "checkbox" } });
            checkbox.checked = true;
            row.createSpan({ text: `同时将 ${current.records.length} 次体验记录（含心得）移入回收站` });
            this.contentEl.createEl("p", { cls: "media-delete-help", text: "取消勾选会保留记录，但记录中的作品链接将失效。" });
          }
          const footer = this.contentEl.createDiv({ cls: "media-delete-actions" });
          const cancel = footer.createEl("button", { text: "取消", attr: { type: "button" } });
          const confirm = footer.createEl("button", { cls: "mod-warning", text: "移入回收站", attr: { type: "button" } });
          cancel.addEventListener("click", () => this.close());
          let saving = false;
          this.scope.register([], "Escape", () => { if (!saving) this.close(); return false; });
          confirm.addEventListener("click", async () => {
            if (saving) return;
            saving = true;
            confirm.disabled = cancel.disabled = true;
            if (checkbox) checkbox.disabled = true;
            confirm.setText("正在处理…");
            try {
              const result = await execute(app, path, {
                deleteRecords: checkbox?.checked !== false,
                expectedRecords: current.records.map(file => file.path)
              });
              saving = false;
              this.close();
              new obsidian.Notice(`${result.kind}已移入仓库的 .trash 回收站，图片已保留`);
              await app.workspace.openLinkText("媒体库/首页", path);
              app.workspace.trigger("dataview:refresh-views");
            } catch (error) {
              new obsidian.Notice(error.userMessage || error.message);
              saving = false;
              confirm.disabled = cancel.disabled = false;
              if (checkbox) checkbox.disabled = false;
              confirm.setText("移入回收站");
            }
          });
          cancel.focus();
          this.canClose = () => !saving;
        }
        close() { if (!this.canClose || this.canClose()) super.close(); }
        onClose() { this.contentEl.empty(); }
      }
      new DeleteModal(app).open();
    });
    return button;
  };
  window.__mediaLibraryDeletion = { version: 2, plan, execute, mount };
}
