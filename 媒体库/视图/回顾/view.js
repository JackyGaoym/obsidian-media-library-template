await dv.view("媒体库/视图/主题");

const typeController = window.__mediaLibraryTypeControllers?.get(app.vault.getName());
const typeDefinitions = typeController?.getTypes() || [];
const typeMeta = Object.fromEntries(typeDefinitions.map(type => [type.id, type]));

const resultMeta = {
  completed: { label: "已完成", cls: "is-completed" },
  abandoned: { label: "已弃置", cls: "is-abandoned" }
};

const toArray = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.array === "function") return value.array();
  return [value];
};

const plainText = value => {
  if (value === null || value === undefined || value === "") return "";
  if (value.path) return value.path.split("/").pop();
  return String(value).replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("/").pop();
};

const linkPath = value => {
  const raw = value?.path ?? String(value || "");
  return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].replace(/\.md$/i, "");
};

const dateText = value => {
  if (!value) return "";
  if (typeof value.toFormat === "function") return value.toFormat("yyyy-MM-dd");
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
};

const yearFrom = value => {
  const match = String(value ?? "").match(/\d{4}/);
  return match ? Number(match[0]) : 0;
};

const numberFrom = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const addInternalLink = (parent, path, text, cls = "") => {
  const link = parent.createEl("a", { cls: `internal-link ${cls}`.trim(), text });
  link.setAttr("data-href", path);
  link.setAttr("href", path.endsWith(".md") ? path : `${path}.md`);
  return link;
};

const setAppIcon = (element, name, fallback) => {
  element.empty();
  try {
    const iconSetter = typeof setIcon === "function"
      ? setIcon
      : (typeof require === "function" ? require("obsidian").setIcon : null);
    if (iconSetter) {
      iconSetter(element, name);
      return;
    }
  } catch (error) {
  }
  element.setText(fallback);
};

const coverUrl = page => {
  if (!page?.file) return "";
  const raw = page.cover?.path ?? String(page.cover || "");
  const path = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  if (!path) return "";
  const file = app.metadataCache.getFirstLinkpathDest(path, page.file.path);
  return file ? app.vault.getResourcePath(file) : "";
};

const currentYear = new Date().getFullYear();
const workPages = dv.pages('"媒体库/作品"')
  .where(page => page.note_type === "media")
  .array();
const workByPath = new Map();
for (const page of workPages) {
  workByPath.set(page.file.path.replace(/\.md$/i, ""), page);
  workByPath.set(page.file.name, page);
}

const workFor = record => {
  const path = linkPath(record.work);
  return workByPath.get(path) || workByPath.get(path.split("/").pop()) || dv.page(path) || null;
};

const verifiedRecords = dv.pages('"媒体库/记录"')
  .where(page => page.note_type === "media_experience" && page.year_verified === true)
  .array()
  .map(record => {
    const work = workFor(record);
    const year = Math.round(numberFrom(record.verified_year));
    const endedAt = dateText(record.ended_at);
    const startedAt = dateText(record.started_at);
    const exactEndYear = yearFrom(endedAt);
    const exactStartYear = yearFrom(startedAt);
    const month = record.date_certainty === "exact" && exactEndYear === year
      ? Number(endedAt.slice(5, 7))
      : 0;
    return {
      record,
      work,
      year,
      month: month >= 1 && month <= 12 ? month : 0,
      startedAt,
      endedAt,
      crossYear: record.date_certainty === "exact"
        && exactStartYear > 0
        && exactEndYear > 0
        && exactStartYear !== exactEndYear,
      title: work?.title || plainText(record.work) || record.file.name,
      type: work?.media_type || "unknown",
      result: record.result || "completed",
      rating: numberFrom(record.experience_rating),
      index: Math.max(1, Math.round(numberFrom(record.experience_index)) || 1),
      progressValue: Math.max(0, numberFrom(record.progress_value)),
      progressTotal: Math.max(0, numberFrom(record.progress_total)),
      progressUnit: String(record.progress_unit || "")
    };
  })
  .filter(item => item.year > 0 && item.work);

const reviewTypeIds = typeDefinitions
  .filter(type => typeController?.isEnabled(type.id) || verifiedRecords.some(item => item.type === type.id))
  .map(type => type.id);

const availableYears = [...new Set([
  currentYear,
  ...verifiedRecords.map(item => item.year)
])].sort((a, b) => b - a);

const state = {
  year: availableYears.includes(currentYear) ? currentYear : availableYears[0],
  type: "all",
  result: "all",
  rating: "all",
  month: 0
};

const progressFor = page => {
  if (!page) return null;
  const progressType = typeController?.progressType(page) || page.media_type;
  const config = progressType === "book"
    ? ["current_page", "page_count", "页"]
    : progressType === "series"
      ? ["current_episode", "episode_count", "集"]
      : progressType === "movie"
        ? ["current_minutes", "runtime_minutes", "分钟"]
        : progressType === "game"
          ? ["progress_percent", null, "%"]
          : null;
  if (!config) return null;
  const current = Math.max(0, numberFrom(page[config[0]]));
  const total = config[1] ? Math.max(0, numberFrom(page[config[1]])) : 100;
  const percent = total > 0 ? Math.max(0, Math.min(100, current / total * 100)) : 0;
  const label = config[2] === "%"
    ? `${Math.round(current)}%`
    : `${Math.round(current)}/${total > 0 ? Math.round(total) : "—"} ${config[2]}`;
  return { current, total, percent, label };
};

const formatMinutes = minutes => {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder} 分钟`;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
};

const titleForExperience = item => {
  const labels = { book: "阅读", tv: "观看", movie: "观看", anime: "观看", game: "游玩", variety: "观看", documentary: "观看" };
  return `第 ${item.index} 次${labels[item.type] || "体验"}`;
};

const root = dv.container.createDiv({ cls: "media-review-app" });
const header = root.createDiv({ cls: "media-review-header" });
const heading = header.createDiv({ cls: "media-review-heading" });
addInternalLink(heading, "媒体库/首页", "← 媒体库", "media-review-back");
const headingLine = heading.createDiv({ cls: "media-review-heading-line" });
headingLine.createEl("h1", { text: `${state.year} 回顾` });
headingLine.createSpan({ cls: "media-review-heading-note", text: "只统计已经确认年份的体验记录" });

const yearNav = header.createDiv({ cls: "media-review-year-nav" });
const olderButton = yearNav.createEl("button", {
  cls: "media-review-year-button",
  attr: { type: "button", title: "上一个有记录的年份", "aria-label": "上一个有记录的年份" }
});
setAppIcon(olderButton, "chevron-left", "‹");
const yearSelect = yearNav.createEl("select", { attr: { "aria-label": "选择回顾年份" } });
for (const year of availableYears) {
  const option = yearSelect.createEl("option", { text: String(year), attr: { value: String(year) } });
  option.selected = year === state.year;
}
const newerButton = yearNav.createEl("button", {
  cls: "media-review-year-button",
  attr: { type: "button", title: "下一个有记录的年份", "aria-label": "下一个有记录的年份" }
});
setAppIcon(newerButton, "chevron-right", "›");

const content = root.createDiv({ cls: "media-review-content" });

const changeYear = direction => {
  const ascending = [...availableYears].sort((a, b) => a - b);
  const currentIndex = ascending.indexOf(state.year);
  const next = ascending[currentIndex + direction];
  if (!next) return;
  state.year = next;
  state.month = 0;
  state.type = "all";
  state.result = "all";
  state.rating = "all";
  yearSelect.value = String(next);
  render();
};

olderButton.addEventListener("click", () => changeYear(-1));
newerButton.addEventListener("click", () => changeYear(1));
yearSelect.addEventListener("change", event => {
  state.year = Number(event.target.value);
  state.month = 0;
  state.type = "all";
  state.result = "all";
  state.rating = "all";
  render();
});

const sectionTitle = (parent, title, subtitle = "") => {
  const row = parent.createDiv({ cls: "media-review-section-title" });
  row.createEl("h2", { text: title });
  if (subtitle) row.createSpan({ text: subtitle });
  return row;
};

const render = () => {
  content.empty();
  headingLine.querySelector("h1").setText(`${state.year} 回顾`);

  const yearRecords = verifiedRecords
    .filter(item => item.year === state.year)
    .sort((a, b) => (b.endedAt || "").localeCompare(a.endedAt || "") || b.index - a.index);
  const completed = yearRecords.filter(item => item.result === "completed");
  const abandoned = yearRecords.filter(item => item.result === "abandoned");
  const rated = yearRecords.filter(item => item.rating > 0);
  const average = rated.length
    ? (rated.reduce((sum, item) => sum + item.rating, 0) / rated.length).toFixed(1)
    : "—";
  const ongoing = state.year === currentYear
    ? workPages.filter(page => ["进行中", "暂停"].includes(page.status))
    : [];
  const uniqueWorks = new Set(yearRecords.map(item => item.work.file.path)).size;
  const repeats = Math.max(0, yearRecords.length - uniqueWorks);
  const crossYearCompleted = completed.filter(item => item.crossYear).length;
  const crossYearAbandoned = abandoned.filter(item => item.crossYear).length;

  const summary = content.createDiv({ cls: "media-review-summary" });
  const stats = [
    ["体验次数", yearRecords.length],
    ["完成", completed.length],
    ["弃置", abandoned.length],
    ["仍在进行", ongoing.length],
    ["平均评分", average]
  ];
  for (const [label, value] of stats) {
    const card = summary.createDiv({ cls: "media-review-stat" });
    card.createDiv({ cls: "media-review-stat-value", text: String(value) });
    card.createDiv({ cls: "media-review-stat-label", text: label });
  }
  const summaryFoot = content.createDiv({ cls: "media-review-summary-foot" });
  summaryFoot.createSpan({ text: `${uniqueWorks} 部作品` });
  summaryFoot.createSpan({ text: repeats ? `${repeats} 次重复体验` : "本年暂无重复体验" });
  if (crossYearCompleted) summaryFoot.createSpan({ text: `${crossYearCompleted} 次跨年完成` });
  if (crossYearAbandoned) summaryFoot.createSpan({ text: `${crossYearAbandoned} 次跨年弃置` });

  if (!yearRecords.length && !ongoing.length) {
    const empty = content.createDiv({ cls: "media-review-empty is-year" });
    empty.createEl("strong", { text: `${state.year} 年还没有可用于回顾的记录` });
    empty.createDiv({ text: "记录确认年份后，会自动出现在这里。" });
    updateYearButtons();
    return;
  }

  const overview = content.createDiv({ cls: "media-review-overview" });
  const timelinePanel = overview.createDiv({ cls: "media-review-panel media-review-timeline-panel" });
  sectionTitle(timelinePanel, "这一年发生了什么", "点击月份可筛选下方记录");
  const monthlyCounts = Array.from({ length: 12 }, (_, index) =>
    yearRecords.filter(item => item.month === index + 1).length);
  const maxMonth = Math.max(1, ...monthlyCounts);
  const monthChart = timelinePanel.createDiv({ cls: "media-review-months" });
  monthlyCounts.forEach((count, index) => {
    const month = index + 1;
    const button = monthChart.createEl("button", {
      cls: `media-review-month${state.month === month ? " is-active" : ""}${count ? " has-records" : ""}`,
      attr: { type: "button", "aria-label": `${month} 月，${count} 次体验` }
    });
    button.disabled = count === 0;
    button.style.setProperty(
      "--media-review-bar-height",
      count ? `${Math.max(10, count / maxMonth * 82)}%` : "3px"
    );
    const track = button.createSpan({ cls: "media-review-month-track" });
    track.createSpan({ cls: "media-review-month-count", text: count ? String(count) : "" });
    const bar = track.createSpan({ cls: "media-review-month-bar" });
    button.createSpan({ cls: "media-review-month-label", text: `${month}月` });
    button.addEventListener("click", () => {
      state.month = state.month === month ? 0 : month;
      render();
      root.querySelector(".media-review-records")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  const unknownMonth = yearRecords.filter(item => item.month === 0).length;
  if (unknownMonth) {
    timelinePanel.createDiv({
      cls: "media-review-unknown-month",
      text: `${unknownMonth} 条只确认年份的记录未分配到具体月份`
    });
  }

  const typePanel = overview.createDiv({ cls: "media-review-panel media-review-types-panel" });
  sectionTitle(typePanel, "体验构成", `${yearRecords.length} 次体验`);
    const typeCounts = reviewTypeIds.map(type => ({
    type,
    count: yearRecords.filter(item => item.type === type).length
  })).filter(item => item.count > 0);
  const maxType = Math.max(1, ...typeCounts.map(item => item.count));
  const typeBars = typePanel.createDiv({ cls: "media-review-type-bars" });
  for (const item of typeCounts) {
    const row = typeBars.createDiv({ cls: `media-review-type-row is-${item.type}` });
    row.createSpan({ cls: "media-review-type-name", text: typeMeta[item.type].label });
    const track = row.createSpan({ cls: "media-review-type-track" });
    const fill = track.createSpan({ cls: "media-review-type-fill" });
    fill.style.setProperty("--media-review-type-width", `${Math.max(8, item.count / maxType * 100)}%`);
    row.createSpan({ cls: "media-review-type-count", text: `${item.count} 次` });
  }

  const investment = content.createDiv({ cls: "media-review-section" });
  sectionTitle(investment, "完成规模", "按完成年份归集；跨年记录无需拆分");
  const investmentGrid = investment.createDiv({ cls: "media-review-investment" });
  const movieMinutes = completed.filter(item => item.progressUnit === "minute")
    .reduce((sum, item) => sum + item.progressValue, 0);
  const episodes = completed.filter(item => item.progressUnit === "episode")
    .reduce((sum, item) => sum + item.progressValue, 0);
  const pages = completed.filter(item => item.type === "book" && item.progressUnit === "page")
    .reduce((sum, item) => sum + item.progressValue, 0);
  const bookCount = completed.filter(item => item.type === "book").length;
  const gameCount = completed.filter(item => item.type === "game").length;
  const investmentItems = [
    movieMinutes > 0 ? ["观看时长", formatMinutes(movieMinutes), "movie"] : null,
    episodes > 0 ? ["剧集进度", `${Math.round(episodes)} 集`, "episode"] : null,
    bookCount > 0 ? ["图书", pages > 0 ? `${Math.round(pages)} 页` : `${bookCount} 本`, "book"] : null,
    gameCount > 0 ? ["游戏", `${gameCount} 款`, "game"] : null
  ].filter(Boolean);
  if (investmentItems.length) {
    for (const [label, value, cls] of investmentItems) {
      const card = investmentGrid.createDiv({ cls: `media-review-investment-card is-${cls}` });
      card.createDiv({ cls: "media-review-investment-label", text: label });
      card.createDiv({ cls: "media-review-investment-value", text: value });
    }
  } else {
    investmentGrid.createDiv({ cls: "media-review-inline-empty", text: "本年完成记录里还没有可计算的规模数据。" });
  }

  const highlights = content.createDiv({ cls: "media-review-section" });
  const highestRating = rated.length ? Math.max(...rated.map(item => item.rating)) : 0;
  sectionTitle(highlights, "高分体验", highestRating ? `本年最高 ${highestRating} 星` : "本年还没有评分");
  const highlightGrid = highlights.createDiv({ cls: "media-review-highlights" });
  const topRecords = highestRating ? rated.filter(item => item.rating === highestRating) : [];
  if (topRecords.length) {
    for (const item of topRecords) {
      const card = highlightGrid.createDiv({ cls: `media-review-highlight is-${item.type}` });
      const cover = coverUrl(item.work);
      const art = card.createDiv({ cls: "media-review-highlight-cover" });
      if (cover) art.style.backgroundImage = `url("${cover}")`;
      const copy = card.createDiv({ cls: "media-review-highlight-copy" });
      addInternalLink(copy, item.work.file.path, item.title, "media-review-highlight-title");
      copy.createDiv({
        cls: "media-review-highlight-meta",
        text: `${typeMeta[item.type]?.label || "作品"} · ${titleForExperience(item)}${item.crossYear ? ` · ${item.result === "abandoned" ? "跨年弃置" : "跨年完成"}` : ""}`
      });
      copy.createDiv({ cls: "media-review-highlight-rating", text: `★ ${item.rating}` });
    }
  } else {
    highlightGrid.createDiv({ cls: "media-review-inline-empty", text: "给一次体验评分后，它会出现在这里。" });
  }

  if (ongoing.length) {
    const ongoingSection = content.createDiv({ cls: "media-review-section" });
    sectionTitle(ongoingSection, "还在路上", "当前进行中与暂停的作品，不计入本年完成量");
    const ongoingGrid = ongoingSection.createDiv({ cls: "media-review-ongoing" });
    for (const page of ongoing) {
      const card = ongoingGrid.createDiv({ cls: `media-review-ongoing-card is-${page.media_type}` });
      const cover = coverUrl(page);
      const art = card.createDiv({ cls: "media-review-ongoing-cover" });
      if (cover) art.style.backgroundImage = `url("${cover}")`;
      const copy = card.createDiv({ cls: "media-review-ongoing-copy" });
      addInternalLink(copy, page.file.path, page.title || page.file.name, "media-review-ongoing-title");
      copy.createDiv({ cls: "media-review-ongoing-meta", text: `${typeMeta[page.media_type]?.label || "作品"} · ${page.status}` });
      const progress = progressFor(page);
      if (progress) {
        const progressLine = copy.createDiv({ cls: "media-review-ongoing-progress" });
        const progressTrack = progressLine.createSpan({ cls: "media-review-ongoing-track" });
        const progressFill = progressTrack.createSpan({ cls: "media-review-ongoing-fill" });
        progressFill.style.setProperty("--media-review-progress", `${progress.percent}%`);
        progressLine.createSpan({ text: progress.label });
      }
    }
  }

  const recordsSection = content.createDiv({ cls: "media-review-section media-review-records" });
  const recordsHeading = sectionTitle(recordsSection, "完整记录", "一次体验就是一条记录");
  const filters = recordsHeading.createDiv({ cls: "media-review-filters" });
  const typeSelect = filters.createEl("select", { attr: { "aria-label": "按媒体类型筛选" } });
  typeSelect.createEl("option", { text: "全部类型", attr: { value: "all" } });
  for (const type of reviewTypeIds) {
    const meta = typeMeta[type];
    const option = typeSelect.createEl("option", { text: meta.label, attr: { value: type } });
    option.selected = state.type === type;
  }
  typeSelect.value = state.type;
  const resultSelect = filters.createEl("select", { attr: { "aria-label": "按体验结果筛选" } });
  resultSelect.createEl("option", { text: "全部结果", attr: { value: "all" } });
  for (const [result, meta] of Object.entries(resultMeta)) {
    const option = resultSelect.createEl("option", { text: meta.label, attr: { value: result } });
    option.selected = state.result === result;
  }
  resultSelect.value = state.result;
  const ratingSelect = filters.createEl("select", { attr: { "aria-label": "按本次评分筛选" } });
  const ratingOptions = [
    ["all", "全部评分"],
    ["4.5", "4.5 星以上"],
    ["4", "4 星以上"],
    ["3", "3 星以上"],
    ["unrated", "未评分"]
  ];
  for (const [value, label] of ratingOptions) {
    const option = ratingSelect.createEl("option", { text: label, attr: { value } });
    option.selected = state.rating === value;
  }
  ratingSelect.value = state.rating;
  if (state.month) {
    const clearMonth = filters.createEl("button", { cls: "media-review-clear-month", text: `${state.month} 月 ×`, attr: { type: "button" } });
    clearMonth.addEventListener("click", () => {
      state.month = 0;
      render();
    });
  }
  typeSelect.addEventListener("change", event => {
    state.type = event.target.value;
    render();
  });
  resultSelect.addEventListener("change", event => {
    state.result = event.target.value;
    render();
  });
  ratingSelect.addEventListener("change", event => {
    state.rating = event.target.value;
    render();
  });

  const filtered = yearRecords.filter(item =>
    (state.type === "all" || item.type === state.type)
    && (state.result === "all" || item.result === state.result)
    && (state.rating === "all"
      || (state.rating === "unrated" ? item.rating <= 0 : item.rating >= Number(state.rating)))
    && (!state.month || item.month === state.month));
  const list = recordsSection.createDiv({ cls: "media-review-record-list" });
  if (!filtered.length) {
    list.createDiv({ cls: "media-review-empty", text: "没有符合当前筛选条件的记录。" });
  }
  for (const item of filtered) {
    const row = list.createDiv({ cls: `media-review-record is-${item.type}` });
    const cover = row.createDiv({ cls: "media-review-record-cover" });
    const url = coverUrl(item.work);
    if (url) cover.style.backgroundImage = `url("${url}")`;
    const copy = row.createDiv({ cls: "media-review-record-copy" });
    addInternalLink(copy, item.work.file.path, item.title, "media-review-record-title");
    const meta = copy.createDiv({ cls: "media-review-record-meta" });
    meta.createSpan({ cls: `media-review-badge is-${item.type}`, text: typeMeta[item.type]?.label || "作品" });
    meta.createSpan({ cls: `media-review-badge ${resultMeta[item.result]?.cls || ""}`, text: resultMeta[item.result]?.label || item.result });
    if (item.crossYear) {
      meta.createSpan({
        cls: "media-review-badge is-cross-year",
        text: item.result === "abandoned" ? "跨年弃置" : "跨年完成"
      });
    }
    if (item.month) meta.createSpan({ text: item.endedAt || `${item.year} 年` });
    else meta.createSpan({ text: `${item.year} 年 · 月份未确认` });
    const right = row.createDiv({ cls: "media-review-record-right" });
    if (item.rating > 0) right.createDiv({ cls: "media-review-record-rating", text: `★ ${item.rating}` });
    addInternalLink(right, item.record.file.path, titleForExperience(item), "media-review-record-link");
  }

  updateYearButtons();
};

const updateYearButtons = () => {
  const ascending = [...availableYears].sort((a, b) => a - b);
  const index = ascending.indexOf(state.year);
  olderButton.disabled = index <= 0;
  newerButton.disabled = index < 0 || index >= ascending.length - 1;
};

render();
