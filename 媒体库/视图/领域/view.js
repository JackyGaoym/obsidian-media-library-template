// Shared data rules and per-file write queue. Commands still validate the latest frontmatter.
if (!window.__mediaLibraryDomain || window.__mediaLibraryDomain.version !== 1) {
  const progressConfigs = Object.freeze({
    book: Object.freeze({ field: "current_page", totalField: "page_count", unit: "页", historyUnit: "page", step: 1 }),
    series: Object.freeze({ field: "current_episode", totalField: "episode_count", unit: "集", historyUnit: "episode", step: 1 }),
    movie: Object.freeze({ field: "current_minutes", totalField: "runtime_minutes", unit: "分", historyUnit: "minute", step: 10 }),
    game: Object.freeze({ field: "progress_percent", totalField: null, unit: "%", historyUnit: "percent", step: 5, fixedTotal: 100 })
  });
  const formatFor = (page, typeController) => {
    const explicit = String(page?.media_format || "");
    if (progressConfigs[explicit]) return explicit;
    const inferred = typeController?.progressType(page);
    if (progressConfigs[inferred]) return inferred;
    const type = String(page?.media_type || "");
    if (type === "book" || type === "movie" || type === "game") return type;
    if (type === "tv" || type === "anime") return "series";
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
  window.__mediaLibraryDomain = { version: 1, progressConfigs, formatFor, runFileWrite };
}
