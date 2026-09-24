await dv.view("媒体库/视图/主题");
await dv.view("媒体库/视图/查询");

const queryController = window.__mediaLibraryQuery;

const current = dv.current();
const currentName = current?.file?.name || "";

const typeController = window.__mediaLibraryTypeControllers?.get(app.vault.getName());
const typeDefinitions = typeController?.getTypes() || [];
const typeMeta = Object.fromEntries(typeDefinitions.map(item => [item.label, { ...item, type: item.id }]));
const typeMetaById = Object.fromEntries(typeDefinitions.map(item => [item.id, item]));

const libraryMeta = {
  全部作品: {
    mode: "all",
    label: "全部作品",
    unit: "部",
    subtitle: "在同一处浏览、搜索和筛选媒体库中的所有作品。",
    pending: "待体验",
    active: "进行中"
  },
  待体验: {
    mode: "pending",
    label: "待体验",
    unit: "部",
    subtitle: "从还没有开始的作品中，找到下一部想读、想看或想玩的内容。",
    pending: "待体验",
    active: "进行中"
  },
  暂停中: {
    mode: "paused",
    label: "暂停中",
    unit: "部",
    subtitle: "打开作品，把状态改回进行中，即可继续本次体验。",
    pending: "待体验",
    active: "进行中"
  }
};

const meta = typeMeta[currentName] || libraryMeta[currentName];
if (!meta) {
  dv.paragraph("无法识别当前媒体类别。");
  return;
}

const metaForPage = page => Object.values(typeMeta).find(item => item.type === page.media_type) || {
  type: page.media_type || "media",
  label: "作品",
  active: "进行中"
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
  return String(value).replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
};

const timestamp = value => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
};

const numberFrom = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const yearFor = page => {
  if (!page.release_date) return "未知年份";
  if (typeof page.release_date.toFormat === "function") return page.release_date.toFormat("yyyy");
  return String(page.release_date).slice(0, 4);
};

const titleFor = page => page.title || page.file.name;

const coverUrl = page => {
  const raw = page.cover?.path ?? String(page.cover || "");
  const linkPath = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  if (!linkPath) return "";
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, page.file.path);
  return file ? app.vault.getResourcePath(file) : "";
};

const progressFor = page => {
  const mediaType = typeController?.progressType(page) || page.media_type || meta.type;
  if (mediaType === "book") {
    const currentPage = numberFrom(page.current_page);
    const total = numberFrom(page.page_count);
    return {
      percent: total > 0 ? Math.min(100, currentPage / total * 100) : 0,
      label: `${currentPage} / ${total || "?"} 页`,
      known: total > 0
    };
  }
  if (mediaType === "series") {
    const currentEpisode = numberFrom(page.current_episode);
    const total = numberFrom(page.episode_count);
    return {
      percent: total > 0 ? Math.min(100, currentEpisode / total * 100) : 0,
      label: `${currentEpisode} / ${total || "?"} 集`,
      known: total > 0
    };
  }
  if (mediaType === "movie") {
    const currentMinutes = numberFrom(page.current_minutes);
    const total = numberFrom(page.runtime_minutes);
    return {
      percent: total > 0 ? Math.min(100, currentMinutes / total * 100) : 0,
      label: `${currentMinutes} / ${total || "?"} 分`,
      known: total > 0
    };
  }
  if (mediaType === "game") {
    const percent = Math.max(0, Math.min(100, numberFrom(page.progress_percent)));
    return { percent, label: `${percent}%`, known: true };
  }
  return { percent: 0, label: "", known: false };
};

const addInternalLink = (parent, path, text, cls = "") => {
  const link = parent.createEl("a", { cls: `internal-link ${cls}`.trim(), text });
  link.setAttr("data-href", path);
  link.setAttr("href", path.endsWith(".md") ? path : `${path}.md`);
  return link;
};

const setAppIcon = (element, name) => {
  try {
    const iconSetter = typeof setIcon === "function"
      ? setIcon
      : (typeof require === "function" ? require("obsidian").setIcon : null);
    if (iconSetter) iconSetter(element, name);
    return Boolean(iconSetter);
  } catch (error) {
    return false;
  }
};

const allItems = dv.pages('"媒体库/作品"')
  .where(page => page.note_type === "media"
    && (!meta.type || page.media_type === meta.type)
    && (meta.mode !== "pending" || page.status === "待体验")
    && (meta.mode !== "paused" || page.status === "暂停"))
  .array();
const mediaGroups = dv.pages('"媒体库/合集"')
  .where(page => page.note_type === "media_collection")
  .array();
const searchEntries = new Map(queryController.createIndex(allItems, mediaGroups, typeMetaById)
  .map(entry => [entry.page.file.path, entry]));
const browsableTypeDefinitions = typeController?.getBrowsableTypes(allItems)
  || typeDefinitions.filter(item => allItems.some(page => page.media_type === item.id));

const stateKey = `media-library-category:${app.vault.getName()}:${currentName}`;
const state = queryController.readState(stateKey, {
  filter: "all",
  query: "",
  sort: "recent",
  view: "grid",
  scrollTop: 0
});
const persistState = () => queryController.saveState(stateKey, state);

const root = dv.container.createDiv({ cls: `media-category-page is-${meta.type || meta.mode}` });
const header = root.createDiv({ cls: "media-category-header" });
const headerCopy = header.createDiv({ cls: "media-category-header-copy" });
addInternalLink(headerCopy, "媒体库/首页", "← 媒体库", "media-category-back");

const titleRow = headerCopy.createDiv({ cls: "media-category-title-row" });
titleRow.createEl("h1", { text: meta.label });
headerCopy.createDiv({ cls: "media-category-subtitle", text: meta.subtitle });

const headerActions = header.createDiv({ cls: "media-category-header-actions" });
headerActions.createSpan({ cls: "media-category-count", text: `${allItems.length} ${meta.unit}` });
if (meta.quickAddChoiceId && typeController?.isEnabled(meta.type)) {
  const addButton = headerActions.createEl("button", { cls: "media-category-add", attr: { type: "button" } });
  const addIcon = addButton.createSpan({ cls: "media-category-add-icon" });
  setAppIcon(addIcon, "plus");
  addButton.createSpan({ text: meta.add });
  addButton.addEventListener("click", () => {
    typeController?.launch(meta.type);
  });
}

const toolbar = root.createDiv({ cls: "media-category-toolbar" });
const filters = toolbar.createDiv({ cls: "media-category-filters", attr: { role: "tablist", "aria-label": "筛选作品" } });
const filterDefs = meta.mode === "pending" || meta.mode === "paused"
  ? [
      ["all", "全部", () => true],
      ...browsableTypeDefinitions.map(item => [item.id, item.label, page => page.media_type === item.id])
    ]
  : [
      ["all", "全部", () => true],
      ["pending", meta.pending, page => page.status === "待体验"],
      ["active", meta.active, page => page.status === "进行中"],
      ["paused", "暂停", page => page.status === "暂停"],
      ["finished", "已完成", page => page.status === "已完成"],
      ["high", "高分", page => typeof page.rating === "number" && page.rating >= 4]
    ];
if (!filterDefs.some(([key]) => key === state.filter)) state.filter = "all";
if (!["recent", "rating", "year", "title"].includes(state.sort)) state.sort = "recent";
if (!["grid", "list"].includes(state.view)) state.view = "grid";
state.query = queryController.normalize(state.query);

const tools = toolbar.createDiv({ cls: "media-category-tools" });
const searchWrap = tools.createDiv({ cls: "media-category-search" });
const searchIcon = searchWrap.createSpan({ cls: "media-category-tool-icon" });
setAppIcon(searchIcon, "search");
const search = searchWrap.createEl("input", {
  attr: { type: "search", placeholder: `搜索${meta.label}`, "aria-label": `搜索${meta.label}` }
});
search.value = state.query;

const sortWrap = tools.createDiv({ cls: "media-category-sort" });
sortWrap.createSpan({ text: "排序：" });
const sort = sortWrap.createEl("select", { attr: { "aria-label": "排序方式" } });
for (const [value, label] of [["recent", "最近加入"], ["rating", "评分最高"], ["year", "发行时间"], ["title", "标题"]]) {
  sort.createEl("option", { text: label, attr: { value } });
}
sort.value = state.sort;

const viewSwitch = tools.createDiv({ cls: "media-category-view-switch", attr: { "aria-label": "显示方式" } });
const gridButton = viewSwitch.createEl("button", { cls: "is-active", attr: { type: "button", "aria-label": "海报视图", "aria-pressed": "true" } });
const listButton = viewSwitch.createEl("button", { attr: { type: "button", "aria-label": "列表视图", "aria-pressed": "false" } });
gridButton.toggleClass("is-active", state.view === "grid");
gridButton.setAttr("aria-pressed", state.view === "grid" ? "true" : "false");
listButton.toggleClass("is-active", state.view === "list");
listButton.setAttr("aria-pressed", state.view === "list" ? "true" : "false");
if (setAppIcon(gridButton, "layout-grid") && setAppIcon(listButton, "list")) {
} else {
  gridButton.setText("海报");
  listButton.setText("列表");
}

const gallery = root.createDiv({ cls: "media-category-gallery" });
const empty = root.createDiv({ cls: "media-category-empty" });

const matchesFilter = page => {
  const definition = filterDefs.find(([key]) => key === state.filter);
  return definition ? definition[2](page) : true;
};

const matchesSearch = page => {
  if (!state.query) return true;
  const entry = searchEntries.get(page.file.path);
  return entry ? queryController.matches(entry, state.query) : false;
};

const compareItems = (a, b) => {
  if (state.sort === "rating") return Number(b.rating || 0) - Number(a.rating || 0) || titleFor(a).localeCompare(titleFor(b), "zh-CN");
  if (state.sort === "year") return timestamp(b.release_date) - timestamp(a.release_date) || titleFor(a).localeCompare(titleFor(b), "zh-CN");
  if (state.sort === "title") return titleFor(a).localeCompare(titleFor(b), "zh-CN");
  return timestamp(b.added_at) - timestamp(a.added_at) || timestamp(b.file.mtime) - timestamp(a.file.mtime);
};

const renderCard = page => {
  const itemMeta = metaForPage(page);
  const card = gallery.createEl("a", { cls: `media-category-card internal-link is-${itemMeta.type}` });
  card.setAttr("data-href", page.file.path);
  card.setAttr("href", page.file.path);
  card.setAttr("aria-label", `打开 ${titleFor(page)}`);

  const cover = card.createDiv({ cls: "media-category-cover" });
  const coverPath = coverUrl(page);
  if (coverPath) {
    const image = cover.createEl("img", { attr: { src: coverPath, alt: `${titleFor(page)}封面`, loading: "lazy" } });
    image.addEventListener("error", () => {
      image.remove();
      cover.createSpan({ cls: "media-category-cover-fallback", text: itemMeta.label });
    });
  } else {
    cover.createSpan({ cls: "media-category-cover-fallback", text: itemMeta.label });
  }

  if (page.status === "进行中") cover.createSpan({ cls: "media-category-cover-state", text: itemMeta.active });

  const copy = card.createDiv({ cls: "media-category-card-copy" });
  copy.createDiv({ cls: "media-category-card-title", text: titleFor(page) });

  const genres = toArray(page.genres).map(plainText).filter(Boolean).slice(0, 2);
  const secondary = [yearFor(page), genres.join(" / ")].filter(Boolean).join(" · ");
  copy.createDiv({ cls: "media-category-card-secondary", text: secondary });

  const statusRow = copy.createDiv({ cls: "media-category-card-status" });
  const status = statusRow.createSpan({ cls: `media-category-status is-${page.status || "unset"}` });
  status.createSpan({ cls: "media-category-status-dot" });
  status.createSpan({ text: page.status === "进行中" ? itemMeta.active : (page.status || "未设置") });
  if (typeof page.rating === "number" && page.rating > 0) {
    statusRow.createSpan({ cls: "media-category-rating", text: `★ ${page.rating.toFixed(1)}` });
  } else if (page.status === "进行中") {
    statusRow.createSpan({ cls: "media-category-rating is-empty", text: "未评分" });
  }

  if (page.status === "进行中") {
    const progress = progressFor(page);
    if (progress.label) {
      const progressRow = copy.createDiv({ cls: "media-category-progress" });
      const track = progressRow.createDiv({ cls: "media-category-progress-track" });
      track.toggleClass("is-unknown", !progress.known);
      const fill = track.createDiv({ cls: "media-category-progress-fill" });
      fill.style.width = `${progress.percent}%`;
      progressRow.createSpan({ cls: "media-category-progress-label", text: progress.label });
    }
  }
};

const render = () => {
  const visible = allItems.filter(page => matchesFilter(page) && matchesSearch(page)).sort(compareItems);
  gallery.empty();
  gallery.toggleClass("is-list", state.view === "list");
  empty.toggleClass("is-visible", visible.length === 0);
  const emptyLabel = meta.mode ? "作品" : meta.label;
  empty.setText(state.query ? `没有找到与“${search.value.trim()}”匹配的${emptyLabel}。` : `这里暂时没有${emptyLabel}。`);
  for (const page of visible) renderCard(page);
  persistState();
};

for (const [key, label, predicate] of filterDefs) {
  const count = allItems.filter(predicate).length;
  const button = filters.createEl("button", {
    cls: key === state.filter ? "is-active" : "",
    attr: { type: "button", role: "tab", "aria-selected": key === state.filter ? "true" : "false" }
  });
  button.createSpan({ text: label });
  button.createSpan({ cls: "media-category-filter-count", text: String(count) });
  button.addEventListener("click", () => {
    state.filter = key;
    for (const sibling of filters.querySelectorAll("button")) {
      const selected = sibling === button;
      sibling.toggleClass("is-active", selected);
      sibling.setAttr("aria-selected", selected ? "true" : "false");
    }
    render();
  });
}

search.addEventListener("input", () => {
  state.query = queryController.normalize(search.value);
  render();
});

sort.addEventListener("change", () => {
  state.sort = sort.value;
  render();
});

gridButton.addEventListener("click", () => {
  state.view = "grid";
  gridButton.addClass("is-active");
  listButton.removeClass("is-active");
  gridButton.setAttr("aria-pressed", "true");
  listButton.setAttr("aria-pressed", "false");
  render();
});

listButton.addEventListener("click", () => {
  state.view = "list";
  listButton.addClass("is-active");
  gridButton.removeClass("is-active");
  listButton.setAttr("aria-pressed", "true");
  gridButton.setAttr("aria-pressed", "false");
  render();
});

render();
queryController.bindScroll(dv.container, state, persistState);
