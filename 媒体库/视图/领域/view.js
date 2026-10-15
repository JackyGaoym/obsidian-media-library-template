// Shared data rules and per-file write queue. Commands still validate the latest frontmatter.
if (!window.__mediaLibraryDomain || window.__mediaLibraryDomain.version !== 2) {
  const progressConfigs = Object.freeze({
    book: Object.freeze({ field: "current_page", totalField: "page_count", unit: "页", historyUnit: "page", step: 1 }),
    series: Object.freeze({ field: "current_episode", totalField: "episode_count", unit: "集", historyUnit: "episode", step: 1 }),
    movie: Object.freeze({ field: "current_minutes", totalField: "runtime_minutes", unit: "分", historyUnit: "minute", step: 10 }),
    game: Object.freeze({ field: "progress_percent", totalField: null, unit: "%", historyUnit: "percent", step: 5, fixedTotal: 100 }),
    music: Object.freeze({ field: "progress_percent", totalField: null, unit: "%", historyUnit: "percent", step: 5, fixedTotal: 100 })
  });
  const formatFor = (page, typeController) => {
    const explicit = String(page?.media_format || "");
    if (progressConfigs[explicit]) return explicit;
    const inferred = typeController?.progressType(page);
    if (progressConfigs[inferred]) return inferred;
    const type = String(page?.media_type || "");
    if (["book", "movie", "game", "music"].includes(type)) return type;
    if (["tv", "anime", "short_drama"].includes(type)) return "series";
    if (Number(page?.episode_count || 0) > 0 || Number(page?.current_episode || 0) > 0) return "series";
    if (Number(page?.runtime_minutes || 0) > 0 || Number(page?.current_minutes || 0) > 0) return "movie";
    return type === "documentary" ? "movie" : "series";
  };
  const queues = new Map();
  const runFileWrite = (vaultName, path, task) => {
    const key = `${vaultName}:${path}`;
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    queues.set(key, current);
    const release = () => {
      if (queues.get(key) === current) queues.delete(key);
    };
    current.then(release, release);
    return current;
  };
  const saveReflection = (app, file, next, expected) => {
    if (!file?.path?.startsWith("媒体库/记录/") || file.extension !== "md") {
      return Promise.reject(new Error("只能在体验记录中保存心得"));
    }
    return runFileWrite(app.vault.getName(), file.path, () => app.fileManager.processFrontMatter(file, fm => {
      if (fm.note_type !== "media_experience") throw new Error("当前文件不是体验记录");
      if (String(fm.reflection || "") !== expected) throw new Error("心得已在其他窗口修改，请重新打开记录后合并内容");
      fm.reflection = next;
    }));
  };
  window.__mediaLibraryDomain = { version: 2, progressConfigs, formatFor, runFileWrite, saveReflection };
}
