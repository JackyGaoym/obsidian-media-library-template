// A record owns its reflection. Work/record snapshot synchronization never copies it.
const getPath = input?.getPath || (() => dv.current().file.path);
let saved = String(input?.initialValue ?? dv.current().reflection ?? "");
const host = (input?.container || dv.container).createDiv({ cls: "media-experience-reflection" });
const obsidian = window.__mediaLibraryObsidian || {};
const notice = message => {
  if (obsidian.Notice) new obsidian.Notice(message);
  else console.warn(message);
};
const domain = window.__mediaLibraryDomain;
let editing = input?.startEditing === true;
let saving = false;
let draft = saved;
const currentFile = app.vault.getAbstractFileByPath(getPath());
const drafts = window.__mediaLibraryReflectionDrafts || (window.__mediaLibraryReflectionDrafts = new WeakMap());
const previous = currentFile && drafts.get(currentFile);
if (previous) { saved = previous.base; draft = previous.text; editing = true; }

const render = () => {
  host.empty();
  const header = host.createDiv({ cls: "media-reflection-header" });
  if (!input?.hideHeading) header.createEl("h2", { text: "心得体会" });
  if (!editing) {
    const edit = header.createEl("button", {
      cls: "media-experience-detail-edit", text: saved ? "编辑心得" : "写下心得", attr: { type: "button" }
    });
    edit.addEventListener("click", () => {
      editing = true; draft = saved;
      if (currentFile) drafts.set(currentFile, { base: saved, text: draft });
      render();
    });
    const content = host.createDiv({ cls: "media-reflection-content" });
    if (saved && obsidian.MarkdownRenderer?.render && dv.component) {
      void obsidian.MarkdownRenderer.render(app, saved, content, getPath(), dv.component);
    } else content.setText(saved || "记录这一次的感受。重读、重看或重听时，可以写下不同的心得。");
    content.classList.toggle("is-empty", !saved);
    return;
  }
  const editor = host.createEl("textarea", { cls: "media-reflection-editor", attr: {
    "aria-label": "本次体验的心得体会", placeholder: "这一次，有什么想记下来的？支持 Markdown。", rows: "8"
  } });
  editor.value = draft;
  editor.disabled = saving;
  editor.addEventListener("input", () => {
    draft = editor.value;
    if (currentFile) drafts.set(currentFile, { base: saved, text: draft });
  });
  const footer = host.createDiv({ cls: "media-delete-actions" });
  const cancel = footer.createEl("button", { text: "取消", attr: { type: "button" } });
  const save = footer.createEl("button", { cls: "mod-cta", text: saving ? "正在保存…" : "保存心得", attr: { type: "button" } });
  cancel.disabled = save.disabled = saving;
  cancel.addEventListener("click", () => {
    editing = false; draft = saved;
    if (currentFile) drafts.delete(currentFile);
    if (input?.onCancel) { input.onCancel(); return; }
    render();
  });
  save.addEventListener("click", async () => {
    if (saving) return;
    const next = draft;
    saving = true;
    render();
    try {
      const file = app.vault.getAbstractFileByPath(getPath());
      if (!file) throw new Error("记录已被移动或删除，请重新打开记录");
      await domain.saveReflection(app, file, next, saved);
      saved = next;
      editing = false;
      drafts.delete(file);
      notice("本次心得已保存");
      input?.onSaved?.();
    } catch (error) {
      notice(`保存失败：${error.message || error}。当前输入已保留，可复制备份。`);
    } finally { saving = false; render(); }
  });
};

render();
