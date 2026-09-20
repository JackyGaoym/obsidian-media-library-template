const typeMeta = {
  book: { label: "图书", unit: "本" },
  tv: { label: "电视剧", unit: "部" },
  movie: { label: "电影", unit: "部" },
  anime: { label: "动漫", unit: "部" },
  game: { label: "游戏", unit: "款" }
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

const normalize = value => plainText(value)
  .normalize("NFKC")
  .toLocaleLowerCase("zh-Hans-CN")
  .replace(/[，。；、·・:：_—–\-\/\\]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const values = value => toArray(value).map(plainText).filter(Boolean);
const titleFor = page => page.title || page.file.name;

const numberFrom = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const timestamp = value => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
};

const yearFor = page => {
  if (!page.release_date) return "未知年份";
  if (typeof page.release_date.toFormat === "function") return page.release_date.toFormat("yyyy");
  const match = String(page.release_date).match(/\d{4}/);
  return match ? match[0] : "未知年份";
};

const coverUrl = page => {
  const raw = page.cover?.path ?? String(page.cover || "");
  const linkPath = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  if (!linkPath) return "";
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, page.file.path);
  return file ? app.vault.getResourcePath(file) : "";
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

const linkPath = value => {
  if (!value) return "";
  if (value.path) return String(value.path).replace(/\.md$/i, "");
  return String(value)
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/\.md$/i, "");
};

const pointsTo = (value, targetPage) => {
  const target = linkPath(value);
  if (!target || !targetPage?.file) return false;
  const pagePath = targetPage.file.path.replace(/\.md$/i, "");
  return target === pagePath
    || target === targetPage.file.name
    || target.endsWith(`/${targetPage.file.name}`);
};

const uniqueTexts = items => [...new Set(items.map(plainText).filter(Boolean))];
const groupTitle = group => group?.title || group?.file?.name || "";
const groupSearchTerms = group => uniqueTexts([
  groupTitle(group),
  group?.file?.name,
  ...values(group?.aliases)
]);

const mediaPages = dv.pages('"媒体库/作品"')
  .where(page => page.note_type === "media")
  .array();

const mediaGroups = dv.pages('"媒体库/合集"')
  .where(page => page.note_type === "media_collection")
  .array();
const seriesGroups = mediaGroups.filter(group => group.collection_kind === "series");
const collectionGroups = mediaGroups.filter(group => group.collection_kind === "collection");

const relationsFor = page => {
  const rawSeries = plainText(page.series);
  const seriesGroup = seriesGroups.find(group => pointsTo(page.series, group));
  const seriesNames = seriesGroup ? groupSearchTerms(seriesGroup) : uniqueTexts([rawSeries]);
  const seriesName = seriesGroup ? groupTitle(seriesGroup) : rawSeries;

  const directValues = toArray(page.collections);
  const directGroups = collectionGroups.filter(group => directValues.some(value => pointsTo(value, group)));
  const inheritedValues = toArray(seriesGroup?.collections);
  const inheritedGroups = collectionGroups.filter(group => inheritedValues.some(value => pointsTo(value, group)));
  const effectiveGroups = [...new Map(
    [...directGroups, ...inheritedGroups].map(group => [group.file.path, group])
  ).values()];

  const unresolvedDirectNames = directValues
    .filter(value => !directGroups.some(group => pointsTo(value, group)))
    .map(plainText);
  const unresolvedInheritedNames = inheritedValues
    .filter(value => !inheritedGroups.some(group => pointsTo(value, group)))
    .map(plainText);
  const collectionNames = uniqueTexts([
    ...effectiveGroups.map(groupTitle),
    ...unresolvedDirectNames,
    ...unresolvedInheritedNames
  ]);
  const collectionBaseTerms = uniqueTexts([
    ...collectionNames,
    ...effectiveGroups.flatMap(groupSearchTerms)
  ]);

  return {
    seriesName,
    seriesTerms: uniqueTexts([
      ...seriesNames,
      ...seriesNames.map(name => `${name}系列`)
    ]),
    collectionNames,
    collectionTerms: uniqueTexts([
      ...collectionBaseTerms,
      ...collectionBaseTerms.map(name => `${name}合集`)
    ])
  };
};

const makeIndexEntry = page => {
  const effectiveRelations = relationsFor(page);
  const titles = [titleFor(page), page.original_title, page.file.name, ...values(page.aliases)].map(plainText).filter(Boolean);
  const people = [
    ...values(page.authors),
    ...values(page.translators),
    ...values(page.directors),
    ...values(page.screenwriters),
    ...values(page.cast),
    plainText(page.publisher),
    plainText(page.developer)
  ].filter(Boolean);
  const relations = [
    ...effectiveRelations.seriesTerms,
    ...effectiveRelations.collectionTerms,
    ...values(page.related),
    plainText(page.source_series)
  ].filter(Boolean);
  const categories = [
    typeMeta[page.media_type]?.label,
    page.media_type,
    page.status,
    ...values(page.genres),
    ...values(page.platforms),
    plainText(page.format),
    ...values(page.country),
    ...values(page.language),
    effectiveRelations.seriesName ? "系列" : "",
    effectiveRelations.collectionNames.length ? "合集" : ""
  ].filter(Boolean);
  const identifiers = [page.release_date, yearFor(page), page.imdb_id, page.isbn, page.source_id]
    .map(plainText)
    .filter(Boolean);
  const sections = {
    titles: titles.map(normalize),
    people: people.map(normalize),
    relations: relations.map(normalize),
    categories: categories.map(normalize),
    identifiers: identifiers.map(normalize)
  };
  return {
    page,
    titles,
    people,
    relations,
    categories,
    effectiveRelations,
    haystack: Object.values(sections).flat().join(" "),
    sections
  };
};

const entries = mediaPages.map(makeIndexEntry);
const state = {
  query: "",
  type: "all",
  status: "all",
  rating: "all",
  favorite: false,
  sort: "relevance"
};

const root = dv.container.createDiv({ cls: "media-search-app" });
const header = root.createDiv({ cls: "media-search-header" });
const headerCopy = header.createDiv({ cls: "media-search-header-copy" });
addInternalLink(headerCopy, "媒体库/首页", "← 媒体库", "media-search-back");
headerCopy.createEl("h1", { text: "搜索作品" });
headerCopy.createDiv({
  cls: "media-search-subtitle",
  text: "从标题、人物、题材、系列、合集、平台和发行年份中查找。"
});
header.createDiv({ cls: "media-search-total", text: `${entries.length} 部作品` });

const searchPanel = root.createDiv({ cls: "media-search-panel" });
const searchBox = searchPanel.createDiv({ cls: "media-search-box" });
const searchIcon = searchBox.createSpan({ cls: "media-search-box-icon" });
searchIcon.setAttr("aria-hidden", "true");
const searchInput = searchBox.createEl("input", {
  attr: {
    type: "search",
    placeholder: "搜索标题、演员、作者、系列、合集、平台……",
    "aria-label": "搜索整个媒体库",
    autocomplete: "off",
    spellcheck: "false"
  }
});
const clearSearch = searchBox.createEl("button", {
  cls: "media-search-clear",
  attr: { type: "button", "aria-label": "清空搜索", title: "清空搜索" }
});
setAppIcon(clearSearch, "x", "×");
clearSearch.hidden = true;

const queryHelp = searchPanel.createDiv({ cls: "media-search-query-help" });
queryHelp.createSpan({ text: "多个关键词请用空格分隔，结果会同时匹配全部关键词，例如 " });
queryHelp.createEl("code", { text: "星际邮差 游戏" });

const typeFilters = searchPanel.createDiv({
  cls: "media-search-type-filters",
  attr: { role: "tablist", "aria-label": "按媒体类型筛选" }
});
const typeButtons = new Map();
for (const [key, label] of [["all", "全部"], ...Object.entries(typeMeta).map(([key, meta]) => [key, meta.label])]) {
  const button = typeFilters.createEl("button", {
    cls: key === "all" ? "is-active" : "",
    attr: { type: "button", role: "tab", "aria-selected": key === "all" ? "true" : "false" }
  });
  button.createSpan({ text: label });
  const count = button.createSpan({ cls: "media-search-type-count" });
  typeButtons.set(key, { button, count });
  button.addEventListener("click", () => {
    state.type = key;
    render();
  });
}

const secondaryFilters = searchPanel.createDiv({ cls: "media-search-secondary-filters" });
const statusSelect = secondaryFilters.createEl("select", { attr: { "aria-label": "状态筛选" } });
for (const [value, label] of [
  ["all", "全部状态"],
  ["待体验", "待体验"],
  ["进行中", "进行中"],
  ["暂停", "暂停"],
  ["已完成", "已完成"],
  ["弃置", "弃置"]
]) statusSelect.createEl("option", { text: label, attr: { value } });

const ratingSelect = secondaryFilters.createEl("select", { attr: { "aria-label": "评分筛选" } });
for (const [value, label] of [
  ["all", "全部评分"],
  ["high", "4 星及以上"],
  ["rated", "已评分"],
  ["unrated", "未评分"]
]) ratingSelect.createEl("option", { text: label, attr: { value } });

const favoriteButton = secondaryFilters.createEl("button", {
  cls: "media-search-favorite",
  attr: { type: "button", "aria-pressed": "false" }
});
const favoriteIcon = favoriteButton.createSpan({ cls: "media-search-filter-icon" });
setAppIcon(favoriteIcon, "heart", "♡");
favoriteButton.createSpan({ text: "仅收藏" });

const resetButton = secondaryFilters.createEl("button", {
  cls: "media-search-reset",
  text: "重置筛选",
  attr: { type: "button" }
});

const resultHeader = root.createDiv({ cls: "media-search-result-header" });
const resultSummary = resultHeader.createDiv({ cls: "media-search-result-summary" });
const sortWrap = resultHeader.createDiv({ cls: "media-search-sort" });
sortWrap.createSpan({ text: "排序：" });
const sortSelect = sortWrap.createEl("select", { attr: { "aria-label": "结果排序" } });
for (const [value, label] of [
  ["relevance", "相关程度"],
  ["recent", "最近加入"],
  ["rating", "评分最高"],
  ["year", "发行时间"],
  ["title", "标题"]
]) sortSelect.createEl("option", { text: label, attr: { value } });

const resultGrid = root.createDiv({ cls: "media-search-results" });
const empty = root.createDiv({ cls: "media-search-empty" });

const matchesText = entry => {
  if (!state.query) return true;
  const terms = state.query.split(" ").filter(Boolean);
  return terms.every(term => entry.haystack.includes(term));
};

const matchesNonTypeFilters = entry => {
  const { page } = entry;
  if (state.status !== "all" && page.status !== state.status) return false;
  const rating = numberFrom(page.rating);
  if (state.rating === "high" && rating < 4) return false;
  if (state.rating === "rated" && rating <= 0) return false;
  if (state.rating === "unrated" && rating > 0) return false;
  if (state.favorite && page.favorite !== true) return false;
  return matchesText(entry);
};

const relevance = entry => {
  if (!state.query) return 0;
  const full = state.query;
  const terms = full.split(" ").filter(Boolean);
  let score = 0;
  const scoreValues = (items, exact, prefix, contains) => {
    let best = 0;
    for (const item of items) {
      if (item === full) best = Math.max(best, exact);
      else if (item.startsWith(full)) best = Math.max(best, prefix);
      else if (item.includes(full)) best = Math.max(best, contains);
      for (const term of terms) {
        if (item === term) best = Math.max(best, exact * 0.7);
        else if (item.startsWith(term)) best = Math.max(best, prefix * 0.7);
        else if (item.includes(term)) best = Math.max(best, contains * 0.7);
      }
    }
    return best;
  };
  score += scoreValues(entry.sections.titles, 120, 90, 64);
  score += scoreValues(entry.sections.people, 48, 38, 28);
  score += scoreValues(entry.sections.relations, 42, 32, 24);
  score += scoreValues(entry.sections.categories, 26, 20, 14);
  score += scoreValues(entry.sections.identifiers, 22, 16, 12);
  return score;
};

const compareEntries = (left, right) => {
  const a = left.page;
  const b = right.page;
  if (state.sort === "relevance" && state.query) {
    return relevance(right) - relevance(left)
      || titleFor(a).localeCompare(titleFor(b), "zh-CN");
  }
  if (state.sort === "rating") {
    return numberFrom(b.rating) - numberFrom(a.rating)
      || titleFor(a).localeCompare(titleFor(b), "zh-CN");
  }
  if (state.sort === "year") {
    return timestamp(b.release_date) - timestamp(a.release_date)
      || titleFor(a).localeCompare(titleFor(b), "zh-CN");
  }
  if (state.sort === "title") return titleFor(a).localeCompare(titleFor(b), "zh-CN");
  return timestamp(b.added_at) - timestamp(a.added_at)
    || timestamp(b.file.mtime) - timestamp(a.file.mtime);
};

const creatorLine = page => {
  if (page.media_type === "book") {
    const authors = values(page.authors).slice(0, 3);
    return authors.length ? `作者：${authors.join(" / ")}` : "";
  }
  if (page.media_type === "game") {
    const developer = plainText(page.developer);
    return developer ? `开发：${developer}` : "";
  }
  const directors = values(page.directors).slice(0, 2);
  const cast = values(page.cast).slice(0, 2);
  if (directors.length) return `导演：${directors.join(" / ")}`;
  return cast.length ? `主演：${cast.join(" / ")}` : "";
};

const relationSummary = entry => {
  const { seriesName, collectionNames } = entry.effectiveRelations;
  if (seriesName && collectionNames.length) {
    return `归属：${[seriesName, ...collectionNames].join(" · ")}`;
  }
  if (seriesName) return `系列：${seriesName}`;
  return collectionNames.length ? `合集：${collectionNames.join(" · ")}` : "";
};

const primaryDetailLine = page => {
  const segments = [creatorLine(page)];
  if (page.media_type === "game") {
    const platforms = values(page.platforms).slice(0, 4);
    if (platforms.length) segments.push(`平台：${platforms.join(" / ")}`);
  }
  return segments.filter(Boolean).join("　");
};

const renderCard = entry => {
  const { page } = entry;
  const title = titleFor(page);
  const card = resultGrid.createEl("a", {
    cls: `media-search-card internal-link is-${page.media_type || "media"}`,
    attr: { href: page.file.path, "data-href": page.file.path, "aria-label": `打开 ${title}` }
  });
  const visual = card.createDiv({ cls: "media-search-cover" });
  const cover = coverUrl(page);
  if (cover) {
    const image = visual.createEl("img", { attr: { src: cover, alt: `${title}封面`, loading: "lazy" } });
    image.addEventListener("error", () => {
      image.remove();
      visual.createSpan({ cls: "media-search-cover-fallback", text: typeMeta[page.media_type]?.label || "作品" });
    });
  } else {
    visual.createSpan({ cls: "media-search-cover-fallback", text: typeMeta[page.media_type]?.label || "作品" });
  }

  const body = card.createDiv({ cls: "media-search-card-body" });
  const titleRow = body.createDiv({ cls: "media-search-card-title-row" });
  titleRow.createDiv({ cls: "media-search-card-title", text: title });
  if (page.favorite === true) {
    const heart = titleRow.createSpan({ cls: "media-search-card-favorite", attr: { "aria-label": "已收藏", title: "已收藏" } });
    setAppIcon(heart, "heart", "♥");
  }
  const original = plainText(page.original_title);
  if (original && normalize(original) !== normalize(title)) {
    body.createDiv({ cls: "media-search-card-original", text: original });
  }

  const badges = body.createDiv({ cls: "media-search-card-badges" });
  badges.createSpan({ cls: "media-search-badge is-type", text: typeMeta[page.media_type]?.label || "作品" });
  badges.createSpan({ cls: `media-search-badge is-status is-${page.status || "unset"}`, text: page.status || "未设置" });
  badges.createSpan({ cls: "media-search-badge is-year", text: yearFor(page) });
  const rating = numberFrom(page.rating);
  if (rating > 0) badges.createSpan({ cls: "media-search-badge is-rating", text: `★ ${rating.toFixed(1)}` });

  const genres = values(page.genres).slice(0, 4);
  if (genres.length) body.createDiv({ cls: "media-search-card-genres", text: genres.join(" · ") });
  const details = [primaryDetailLine(page), relationSummary(entry)].filter(Boolean);
  for (const text of details) {
    const detail = body.createDiv({ cls: "media-search-card-detail", text });
    detail.setAttr("title", text);
  }
};

const render = () => {
  const candidates = entries.filter(matchesNonTypeFilters);
  const visible = candidates
    .filter(entry => state.type === "all" || entry.page.media_type === state.type)
    .sort(compareEntries);

  for (const [key, refs] of typeButtons) {
    const count = key === "all"
      ? candidates.length
      : candidates.filter(entry => entry.page.media_type === key).length;
    refs.count.setText(String(count));
    const selected = state.type === key;
    refs.button.toggleClass("is-active", selected);
    refs.button.setAttr("aria-selected", selected ? "true" : "false");
  }

  clearSearch.hidden = !searchInput.value;
  favoriteButton.toggleClass("is-active", state.favorite);
  favoriteButton.setAttr("aria-pressed", state.favorite ? "true" : "false");
  resetButton.disabled = !state.query
    && state.type === "all"
    && state.status === "all"
    && state.rating === "all"
    && !state.favorite;
  resultSummary.setText(state.query
    ? `找到 ${visible.length} 部与“${searchInput.value.trim()}”匹配的作品`
    : `显示 ${visible.length} 部作品`);

  resultGrid.empty();
  empty.toggleClass("is-visible", visible.length === 0);
  empty.setText(state.query
    ? `没有找到同时包含这些线索的作品：${searchInput.value.trim()}`
    : "当前筛选条件下没有作品。");
  for (const entry of visible) renderCard(entry);
};

searchInput.addEventListener("input", () => {
  state.query = normalize(searchInput.value);
  render();
});
searchInput.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !searchInput.value) return;
  searchInput.value = "";
  state.query = "";
  render();
});
clearSearch.addEventListener("click", () => {
  searchInput.value = "";
  state.query = "";
  render();
  searchInput.focus();
});
statusSelect.addEventListener("change", () => {
  state.status = statusSelect.value;
  render();
});
ratingSelect.addEventListener("change", () => {
  state.rating = ratingSelect.value;
  render();
});
favoriteButton.addEventListener("click", () => {
  state.favorite = !state.favorite;
  render();
});
sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  render();
});
resetButton.addEventListener("click", () => {
  state.query = "";
  state.type = "all";
  state.status = "all";
  state.rating = "all";
  state.favorite = false;
  searchInput.value = "";
  statusSelect.value = "all";
  ratingSelect.value = "all";
  sortSelect.value = "relevance";
  state.sort = "relevance";
  render();
  searchInput.focus();
});

render();
window.setTimeout(() => searchInput.focus(), 80);
