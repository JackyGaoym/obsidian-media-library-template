await dv.view("媒体库/视图/健康规则");

const works = dv.pages('"媒体库/作品"').where(page => page.note_type === "media").array();
const records = dv.pages('"媒体库/记录"').where(page => page.note_type === "media_experience").array();
const issues = window.__mediaLibraryHealth.inspect(works, records);
const root = dv.container.createDiv({ cls: "media-health-page" });
const back = root.createEl("a", { cls: "internal-link", text: "← 媒体库" });
back.setAttr("data-href", "媒体库/首页");
back.setAttr("href", "媒体库/首页.md");
root.createEl("h1", { text: "数据健康检查" });
root.createEl("p", { text: `已检查 ${works.length} 部作品、${records.length} 条体验记录。此页只报告问题，不修改笔记。` });
if (!issues.length) {
  root.createEl("p", { text: "当前规则未发现问题。" });
} else {
  root.createEl("p", { text: `发现 ${issues.length} 项需核对：${issues.filter(issue => issue.level === "error").length} 项关联或数据冲突，${issues.filter(issue => issue.level === "warning").length} 项待确认。` });
  const list = root.createEl("ul");
  for (const issue of issues) {
    const item = list.createEl("li");
    item.createSpan({ text: `${issue.level === "error" ? "冲突" : "核对"} · ` });
    const link = item.createEl("a", { cls: "internal-link", text: issue.title });
    link.setAttr("data-href", issue.path);
    link.setAttr("href", issue.path);
    item.createSpan({ text: `：${issue.message}` });
  }
}
