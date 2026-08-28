const toArray = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.array === "function") return value.array();
  return [value];
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

const resourceUrl = (value, sourcePath) => {
  const raw = value?.path ?? String(value || "");
  const target = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  if (!target) return "";
  const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  return file ? app.vault.getResourcePath(file) : "";
};

const releaseDateValue = value => {
  if (!value) return "\uffff";
  if (typeof value.toISODate === "function") return value.toISODate();
  return String(value);
};

const yearText = value => {
  const date = releaseDateValue(value);
  const match = date.match(/^\d{4}/);
  return match ? match[0] : "";
};

const titleOf = page => page?.title || page?.file?.name || "未命名";
const sortByTitle = (left, right) => titleOf(left).localeCompare(titleOf(right), "zh-Hans-CN");
const sortWorks = items => [...items].sort((left, right) => {
  const dateOrder = releaseDateValue(left.release_date).localeCompare(releaseDateValue(right.release_date));
  return dateOrder || sortByTitle(left, right);
});

const uniqueWorks = items => [...new Map(items.map(item => [item.file.path, item])).values()];

const addIcon = (element, name) => {
  try {
    if (typeof setIcon === "function") setIcon(element, name);
    else if (typeof window.setIcon === "function") window.setIcon(element, name);
  } catch (error) {
    console.debug("图标加载失败", name, error);
  }
};

const addInternalLink = (parent, page, label, cls = "") => {
  const link = parent.createEl("a", {
    cls: `internal-link ${cls}`.trim(),
    text: label == null ? titleOf(page) : label
  });
  link.setAttr("href", page.file.path);
  link.setAttr("data-href", page.file.path);
  return link;
};

const allGroups = dv.pages('"媒体库/合集"')
  .where(page => page.note_type === "media_collection")
  .array();

const collections = allGroups
  .filter(page => page.collection_kind === "collection")
  .sort(sortByTitle);

const series = allGroups
  .filter(page => page.collection_kind === "series")
  .sort(sortByTitle);

const allWorks = dv.pages('"媒体库/作品"')
  .where(page => page.note_type === "media")
  .array();

const dataCache = new Map();

const dataFor = group => {
  if (dataCache.has(group.file.path)) return dataCache.get(group.file.path);

  if (group.collection_kind === "series") {
    const members = sortWorks(allWorks.filter(work => pointsTo(work.series, group)));
    const parentCollections = collections.filter(collection =>
      toArray(group.collections).some(value => pointsTo(value, collection))
    );
    const data = { members, parentCollections, linkedSeries: [], independentMembers: members };
    dataCache.set(group.file.path, data);
    return data;
  }

  const linkedSeries = series.filter(seriesPage =>
    toArray(seriesPage.collections).some(value => pointsTo(value, group))
  );
  const directMembers = allWorks.filter(work =>
    toArray(work.collections).some(value => pointsTo(value, group))
  );
  const inheritedMembers = linkedSeries.flatMap(seriesPage =>
    allWorks.filter(work => pointsTo(work.series, seriesPage))
  );
  const members = sortWorks(uniqueWorks([...directMembers, ...inheritedMembers]));
  const independentMembers = sortWorks(directMembers.filter(work =>
    !linkedSeries.some(seriesPage => pointsTo(work.series, seriesPage))
  ));
  const data = { members, parentCollections: [], linkedSeries, independentMembers };
  dataCache.set(group.file.path, data);
  return data;
};

const coverFor = (group, members = []) => {
  const own = resourceUrl(group.cover, group.file.path);
  if (own) return own;
  const fallback = members.find(member => member.cover);
  return fallback ? resourceUrl(fallback.cover, fallback.file.path) : "";
};

const heroFor = (group, data) => {
  const ownBackdrop = resourceUrl(group.backdrop, group.file.path);
  if (ownBackdrop) return ownBackdrop;
  if (group.collection_kind === "collection" && data.linkedSeries.length) {
    const linked = data.linkedSeries[0];
    const linkedCover = resourceUrl(linked.cover, linked.file.path);
    if (linkedCover) return linkedCover;
  }
  const memberCover = data.members.find(member => member.cover);
  if (memberCover) {
    const memberUrl = resourceUrl(memberCover.cover, memberCover.file.path);
    if (memberUrl) return memberUrl;
  }
  return coverFor(group, data.members);
};

const yearRange = members => {
  const years = members.map(member => yearText(member.release_date)).filter(Boolean).sort();
  if (!years.length) return "";
  return years[0] === years[years.length - 1] ? years[0] : `${years[0]}–${years[years.length - 1]}`;
};

const defaultDescription = group => group.collection_kind === "series"
  ? "同一系列中的作品会按发布时间自动排列，便于连续浏览。"
  : "围绕共同主题收录系列与独立作品，并自动汇总其中的全部内容。";

const root = dv.container.createDiv({ cls: "media-collection-index-app" });
const sidebar = root.createEl("aside", { cls: "media-collection-index-sidebar" });
const search = sidebar.createDiv({ cls: "media-collection-index-search" });
const searchIcon = search.createSpan({ cls: "media-collection-index-search-icon" });
addIcon(searchIcon, "search");
const searchInput = search.createEl("input", {
  attr: {
    type: "search",
    placeholder: "搜索合集或系列…",
    "aria-label": "搜索合集或系列"
  }
});
const navigation = sidebar.createDiv({ cls: "media-collection-index-navigation" });
const panel = root.createEl("main", { cls: "media-collection-index-panel" });

let selected = collections[0]
  || series[0]
  || null;

const renderThumb = (parent, group, cls, members = [], mode = "cover") => {
  const visual = parent.createDiv({
    cls: `${cls} is-${group.collection_kind}`
  });
  const cover = mode === "hero"
    ? heroFor(group, dataFor(group))
    : coverFor(group, members);
  if (cover) {
    const image = visual.createEl("img");
    image.setAttr("src", cover);
    image.setAttr("alt", "");
    image.setAttr("loading", "lazy");
  } else {
    visual.createSpan({ text: group.collection_kind === "series" ? "系列" : "合集" });
  }
  return visual;
};

const selectGroup = group => {
  selected = group;
  renderNavigation(searchInput.value);
  renderPanel(group);
  panel.scrollTop = 0;
};

const renderNavigation = (query = "") => {
  navigation.empty();
  const normalized = query.trim().toLocaleLowerCase("zh-Hans-CN");
  const sections = [
    ["合集", collections],
    ["系列", series]
  ];

  let visibleCount = 0;
  for (const [label, groups] of sections) {
    const matches = groups.filter(group => {
      if (!normalized) return true;
      const data = dataFor(group);
      const relationText = [
        ...data.parentCollections.map(titleOf),
        ...data.linkedSeries.map(titleOf)
      ].join(" ");
      return `${titleOf(group)} ${group.description || ""} ${relationText}`
        .toLocaleLowerCase("zh-Hans-CN")
        .includes(normalized);
    });
    if (!matches.length) continue;
    visibleCount += matches.length;

    const section = navigation.createDiv({ cls: "media-collection-index-nav-section" });
    const heading = section.createDiv({ cls: "media-collection-index-nav-heading" });
    heading.createSpan({ text: label });
    heading.createSpan({ cls: "media-collection-index-nav-count", text: String(matches.length) });
    const list = section.createDiv({ cls: "media-collection-index-nav-list" });

    for (const group of matches) {
      const data = dataFor(group);
      const item = list.createEl("button", {
        cls: `media-collection-index-nav-item${selected?.file.path === group.file.path ? " is-selected" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": selected?.file.path === group.file.path ? "true" : "false"
        }
      });
      renderThumb(item, group, "media-collection-index-nav-cover", data.members);
      item.createSpan({ cls: "media-collection-index-nav-title", text: titleOf(group) });
      item.createSpan({ cls: "media-collection-index-nav-total", text: String(data.members.length) });
      item.addEventListener("click", () => selectGroup(group));
    }
  }

  if (!visibleCount) {
    navigation.createDiv({
      cls: "media-collection-index-nav-empty",
      text: "没有找到匹配的合集或系列。"
    });
  }
};

const createSection = (title, description = "") => {
  const section = panel.createEl("section", { cls: "media-collection-index-section" });
  const heading = section.createDiv({ cls: "media-collection-index-section-heading" });
  heading.createEl("h2", { text: title });
  if (description) heading.createDiv({ text: description });
  return section;
};

const renderRelationRow = (section, relation, contextLabel) => {
  const data = dataFor(relation);
  const row = section.createEl("button", {
    cls: "media-collection-index-relation",
    attr: { type: "button" }
  });
  renderThumb(row, relation, "media-collection-index-relation-cover", data.members);
  const copy = row.createDiv({ cls: "media-collection-index-relation-copy" });
  copy.createDiv({ cls: "media-collection-index-relation-title", text: titleOf(relation) });
  const description = relation.description || defaultDescription(relation);
  copy.createDiv({ cls: "media-collection-index-relation-description", text: String(description) });
  const meta = copy.createDiv({ cls: "media-collection-index-relation-meta" });
  meta.createSpan({ text: `${data.members.length} 部作品` });
  const range = yearRange(data.members);
  if (range) meta.createSpan({ text: range });
  const context = row.createDiv({ cls: "media-collection-index-relation-context" });
  context.createSpan({ text: contextLabel });
  const arrow = context.createSpan({ cls: "media-collection-index-relation-arrow" });
  addIcon(arrow, "chevron-right");
  row.addEventListener("click", () => selectGroup(relation));
};

const renderWorkStrip = (section, works, emptyText) => {
  if (!works.length) {
    section.createDiv({ cls: "media-collection-index-section-empty", text: emptyText });
    return;
  }

  const strip = section.createDiv({
    cls: "media-collection-index-work-strip",
    attr: {
      tabindex: "0",
      role: "region",
      "aria-label": "作品横向列表，可左右滚动"
    }
  });
  for (const work of works) {
    const link = addInternalLink(strip, work, "", "media-collection-index-work");
    const cover = resourceUrl(work.cover, work.file.path);
    if (cover) {
      const image = link.createEl("img");
      image.setAttr("src", cover);
      image.setAttr("alt", titleOf(work));
      image.setAttr("loading", "lazy");
    } else {
      link.createSpan({ text: titleOf(work) });
    }
    const caption = link.createSpan({ cls: "media-collection-index-work-caption" });
    caption.createSpan({ text: titleOf(work) });
    const year = yearText(work.release_date);
    if (year) caption.createEl("small", { text: year });
  }
};

const renderPanel = group => {
  panel.empty();
  if (!group) {
    panel.createDiv({ cls: "media-collection-index-panel-empty", text: "还没有合集或系列。" });
    return;
  }

  const data = dataFor(group);
  const hero = panel.createDiv({ cls: "media-collection-index-hero" });
  const customBackdrop = resourceUrl(group.backdrop, group.file.path);
  const backdrop = customBackdrop || coverFor(group, data.members);
  if (backdrop) {
    hero.addClass("has-artwork");
    hero.addClass(customBackdrop ? "has-custom-backdrop" : "uses-cover-backdrop");
    const backdropImage = hero.createEl("img", { cls: "media-collection-index-hero-backdrop" });
    backdropImage.setAttr("src", backdrop);
    backdropImage.setAttr("alt", "");
    backdropImage.setAttr("aria-hidden", "true");
    backdropImage.style.setProperty(
      "object-position",
      String(group.backdrop_position || "center"),
      "important"
    );
  }

  const foregroundCover = hero.createDiv({ cls: "media-collection-index-hero-cover" });
  const cover = coverFor(group, data.members);
  if (cover) {
    const coverImage = foregroundCover.createEl("img");
    coverImage.setAttr("src", cover);
    coverImage.setAttr("alt", `${titleOf(group)}封面`);
  } else {
    foregroundCover.createSpan({
      text: group.collection_kind === "series" ? "系列封面" : "合集封面"
    });
  }

  const identity = hero.createDiv({ cls: "media-collection-index-identity" });
  const identityCopy = identity.createDiv({ cls: "media-collection-index-identity-copy" });
  const titleRow = identityCopy.createDiv({ cls: "media-collection-index-title-row" });
  titleRow.createEl("h1", { text: titleOf(group) });
  titleRow.createSpan({
    cls: `media-collection-index-kind is-${group.collection_kind}`,
    text: group.collection_kind === "series" ? "系列" : "合集"
  });
  identityCopy.createDiv({ cls: "media-collection-index-total", text: `共 ${data.members.length} 部作品` });
  identityCopy.createDiv({
    cls: "media-collection-index-description",
    text: group.description ? String(group.description) : defaultDescription(group)
  });

  const open = addInternalLink(
    identity,
    group,
    group.collection_kind === "series" ? "打开系列" : "打开合集",
    "media-collection-index-open"
  );
  const openIcon = open.createSpan({ cls: "media-collection-index-open-icon" });
  addIcon(openIcon, "external-link");

  if (group.collection_kind === "collection") {
    const relationSection = createSection("包含的系列");
    if (data.linkedSeries.length) {
      for (const linked of data.linkedSeries) {
        renderRelationRow(relationSection, linked, `所属合集：${titleOf(group)}`);
      }
    } else {
      relationSection.createDiv({
        cls: "media-collection-index-section-empty",
        text: "当前还没有直接关联的系列。"
      });
    }

    const worksSection = createSection(
      "独立收录",
      "不属于上述系列、但直接收录在本合集中的作品。"
    );
    renderWorkStrip(worksSection, data.independentMembers, "当前没有独立收录的作品。");
  } else {
    const parentSection = createSection("所属合集");
    if (data.parentCollections.length) {
      for (const collection of data.parentCollections) {
        renderRelationRow(parentSection, collection, `包含系列：${titleOf(group)}`);
      }
    } else {
      parentSection.createDiv({
        cls: "media-collection-index-section-empty",
        text: "这个系列暂未加入任何合集。"
      });
    }

    const worksSection = createSection("系列作品", "默认按发布时间排列。");
    renderWorkStrip(worksSection, data.members, "这个系列还没有作品。");
  }

  const footer = panel.createDiv({ cls: "media-collection-index-footer" });
  const updated = group.file.mtime?.toFormat
    ? group.file.mtime.toFormat("yyyy-MM-dd HH:mm")
    : String(group.file.mtime || "");
  footer.createSpan({ text: updated ? `最后更新：${updated}` : "" });
  addInternalLink(footer, group, "管理关联", "media-collection-index-manage");
};

searchInput.addEventListener("input", () => renderNavigation(searchInput.value));
renderNavigation();
renderPanel(selected);
