// Read-only checks. Keep findings as pointers to source notes; never repair data on render.
if (!window.__mediaLibraryHealth || window.__mediaLibraryHealth.version !== 1) {
  const dateText = value => {
    if (!value) return "";
    if (typeof value.toFormat === "function") return value.toFormat("yyyy-MM-dd");
    return String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
  };
  const linkPath = value => String(value?.path ?? value ?? "")
    .replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].replace(/\.md$/i, "");
  const pathFor = page => page?.file?.path || "";
  const titleFor = page => page?.title || page?.file?.name || "未知笔记";
  const indexFor = page => Math.round(Number(page?.experience_index) || 1);
  const inspect = (works, records) => {
    const issues = [];
    const add = (code, level, page, message) => issues.push({ code, level, path: pathFor(page), title: titleFor(page), message });
    const worksByPath = new Map(works.map(work => [pathFor(work).replace(/\.md$/i, ""), work]));
    const worksByName = new Map();
    for (const work of works) {
      const name = work.file?.name;
      if (!name) continue;
      if (worksByName.has(name)) worksByName.set(name, null);
      else worksByName.set(name, work);
    }
    const recordKeys = new Map();
    const endedKeys = new Set();
    for (const record of records) {
      const rawPath = linkPath(record.work);
      const work = worksByPath.get(rawPath) || worksByName.get(rawPath) || null;
      if (!work) {
        add("orphan-record", "error", record, "关联作品不存在或短名称有歧义；年度回顾不会统计这条记录。");
        continue;
      }
      const key = `${pathFor(work)}:${indexFor(record)}`;
      if (recordKeys.has(key)) {
        add("duplicate-experience", "error", record, `与「${titleFor(recordKeys.get(key))}」使用相同的作品和体验次数。`);
      } else recordKeys.set(key, record);
      if (record.record_state !== "reopened") endedKeys.add(key);
      if (record.record_state === "reopened" && ["已完成", "弃置"].includes(work.status)) {
        add("reopened-ended", "error", record, "记录已标为重新打开，但作品状态仍为已结束。");
      }
      const start = dateText(record.started_at);
      const end = dateText(record.ended_at);
      if (start && end && start > end) add("date-order", "error", record, "体验开始日期晚于结束日期。");
      if (record.date_certainty === "exact" && !end) {
        add("exact-without-date", "warning", record, "结束日期标为精确，但没有结束日期。");
      }
      const year = Math.round(Number(record.verified_year) || 0);
      if (record.year_verified === true && !year) {
        add("missing-verified-year", "warning", record, "已确认年份，但未填写确认年份；年度回顾不会统计。");
      }
      if (record.date_certainty === "exact" && end && year && Number(end.slice(0, 4)) !== year) {
        add("year-conflict", "error", record, "精确结束日期的年份与确认年份不一致。");
      }
    }
    const sourceKeys = new Map();
    for (const work of works) {
      if (work.progress_minute !== undefined && work.progress_minute !== null && work.progress_minute !== "") {
        add("shadow-progress", "warning", work, "存在旧字段 progress_minute；先核对它与 current_minutes 的值。");
      }
      const start = dateText(work.started_at);
      const finish = dateText(work.finished_at);
      if (start && finish && start > finish) add("work-date-order", "error", work, "当前体验开始日期晚于完成日期。");
      if (work.status === "已完成" || work.status === "弃置") {
        const key = `${pathFor(work)}:${indexFor(work)}`;
        if (!endedKeys.has(key)) add("missing-snapshot", "warning", work, "当前已结束体验没有对应的有效历史记录；可能尚未归档。");
      }
      for (const field of ["source_id", "isbn", "imdb_id"]) {
        const value = String(work[field] || "").trim();
        if (!value) continue;
        const source = field === "source_id" ? String(work.source || "unknown").trim().toLowerCase() : "";
        const key = `${field}:${source}:${value.toLowerCase()}`;
        const previous = sourceKeys.get(key);
        if (previous) add("duplicate-source", "warning", work, `${field} 与「${titleFor(previous)}」相同，请核对是否重复建档或不同版本。`);
        else sourceKeys.set(key, work);
      }
    }
    return issues;
  };
  window.__mediaLibraryHealth = { version: 1, inspect };
}
