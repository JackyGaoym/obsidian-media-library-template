const page = dv.current();

if (!page || page.note_type !== "media") {
  return;
}

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

const plainText = value => {
  const path = linkPath(value);
  return path ? path.split("/").pop() : "";
};

const groups = dv.pages('"媒体库/合集"')
  .where(group => group.note_type === "media_collection")
  .array();
const seriesOptions = groups
  .filter(group => group.collection_kind === "series")
  .sort((left, right) => String(left.title || left.file.name).localeCompare(String(right.title || right.file.name), "zh-Hans-CN"));
const collectionOptions = groups
  .filter(group => group.collection_kind === "collection")
  .sort((left, right) => String(left.title || left.file.name).localeCompare(String(right.title || right.file.name), "zh-Hans-CN"));
const allWorks = dv.pages('"媒体库/作品"')
  .where(work => work.note_type === "media")
  .array();

const workFile = app.vault.getFileByPath(page.file.path);
let currentSeries = page.series || "";
let currentCollections = toArray(page.collections);
let currentRelated = toArray(page.related);
const root = dv.container.createDiv({ cls: "media-work-relations-editor" });

const setButtonIcon = (button, iconName, fallback) => {
  const icon = button.createSpan({ cls: "media-work-relation-icon" });
  try {
    if (typeof setIcon === "function") setIcon(icon, iconName);
    else icon.setText(fallback);
  } catch (error) {
    icon.setText(fallback);
  }
};

const matchesGroup = (value, group) => {
  const path = linkPath(value);
  if (!path || !group?.file) return false;
  const groupPath = group.file.path.replace(/\.md$/i, "");
  return path === groupPath || path === group.file.name || path.endsWith(`/${group.file.name}`);
};

const groupFor = value => groups.find(group => matchesGroup(value, group));

const matchesWork = (value, work) => {
  const path = linkPath(value);
  if (!path || !work?.file) return false;
  const workPath = work.file.path.replace(/\.md$/i, "");
  return path === workPath || path === work.file.name || path.endsWith(`/${work.file.name}`);
};

const workFor = value => allWorks.find(work => matchesWork(value, work));

const workLink = work => `[[${work.file.name}]]`;

const normalizeLinks = (values, matcher, fallback) => {
  const result = [];
  const seen = new Set();
  for (const value of toArray(values)) {
    const target = matcher(value);
    const key = target?.file?.path || linkPath(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(target ? fallback(target) : `[[${plainText(value)}]]`);
  }
  return result;
};

const syncSeriesCollection = async (collectionGroup, nextCollections) => {
  const seriesGroup = groupFor(currentSeries);
  if (!seriesGroup || !collectionGroup) return;
  const seriesMembers = allWorks.filter(work => matchesGroup(work.series, seriesGroup));
  const complete = seriesMembers.length > 0 && seriesMembers.every(work => {
    const collections = work.file.path === page.file.path ? nextCollections : toArray(work.collections);
    return collections.some(value => matchesGroup(value, collectionGroup));
  });
  const seriesFile = app.vault.getFileByPath(seriesGroup.file.path);
  if (!seriesFile) return;

  await app.fileManager.processFrontMatter(seriesFile, frontmatter => {
    const existing = Array.isArray(frontmatter.collections)
      ? [...frontmatter.collections]
      : (frontmatter.collections ? [frontmatter.collections] : []);
    const alreadyLinked = existing.some(value => matchesGroup(value, collectionGroup));
    if (complete && !alreadyLinked) existing.push(`[[${collectionGroup.file.name}]]`);
    frontmatter.collections = complete
      ? existing
      : existing.filter(value => !matchesGroup(value, collectionGroup));
  });
};

const writeRelations = async updater => {
  if (!workFile) throw new Error("没有找到当前作品文件");
  await app.fileManager.processFrontMatter(workFile, updater);
};

const updateRelatedSide = async (targetWork, sourceWork, shouldLink) => {
  const targetFile = app.vault.getFileByPath(targetWork.file.path);
  if (!targetFile) throw new Error(`没有找到作品文件：${targetWork.file.path}`);

  await app.fileManager.processFrontMatter(targetFile, frontmatter => {
    const existing = normalizeLinks(frontmatter.related, workFor, workLink)
      .filter(value => !matchesWork(value, sourceWork));
    if (shouldLink) existing.push(workLink(sourceWork));
    frontmatter.related = existing;
  });
};

const setRelatedWorks = async nextRelated => {
  const currentWork = allWorks.find(work => work.file.path === page.file.path);
  if (!currentWork) throw new Error("没有在媒体库中找到当前作品");

  const before = currentRelated.map(workFor).filter(Boolean);
  const after = nextRelated.map(workFor).filter(Boolean);
  const beforePaths = new Set(before.map(work => work.file.path));
  const afterPaths = new Set(after.map(work => work.file.path));

  await writeRelations(frontmatter => {
    frontmatter.related = after.map(workLink);
  });

  for (const target of after) {
    if (!beforePaths.has(target.file.path)) await updateRelatedSide(target, currentWork, true);
  }
  for (const target of before) {
    if (!afterPaths.has(target.file.path)) await updateRelatedSide(target, currentWork, false);
  }

  currentRelated = after.map(workLink);
};

const openPicker = ({ kind, options, excluded = [], onChoose }) => {
  const excludedPaths = new Set(excluded.map(linkPath));
  const overlay = document.body.createDiv({ cls: "media-work-relation-overlay modal-container" });
  const modal = overlay.createDiv({
    cls: "media-work-relation-modal modal",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": `选择${kind}` }
  });
  const closeButton = modal.createEl("button", {
    cls: "modal-close-button",
    attr: { type: "button", "aria-label": "关闭" }
  });
  setButtonIcon(closeButton, "x", "×");

  const content = modal.createDiv({ cls: "modal-content" });
  content.createEl("h1", { cls: "modal-title", text: `选择${kind}` });
  const search = content.createEl("input", {
    cls: "media-work-relation-search",
    attr: { type: "search", placeholder: `搜索${kind}…`, "aria-label": `搜索${kind}` }
  });
  const list = content.createDiv({ cls: "media-work-relation-list", attr: { role: "list" } });

  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  };
  const onKeydown = event => {
    if (event.key === "Escape") close();
  };
  const renderOptions = () => {
    list.empty();
    const query = search.value.trim().toLocaleLowerCase("zh-Hans-CN");
    const visible = options.filter(group => {
      const path = group.file.path.replace(/\.md$/i, "");
      if (excludedPaths.has(path) || excludedPaths.has(group.file.name)) return false;
      const searchable = [group.title, group.file.name, group.description]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-Hans-CN");
      return !query || searchable.includes(query);
    });

    if (!visible.length) {
      list.createDiv({ cls: "media-work-relation-empty", text: query ? "没有找到匹配结果" : `没有可添加的${kind}` });
      return;
    }

    for (const group of visible) {
      const isWorkOption = kind === "相关作品";
      const option = list.createEl("button", {
        cls: "media-work-relation-option",
        attr: { type: "button", role: "listitem" }
      });
      const copy = option.createDiv({ cls: "media-work-relation-option-copy" });
      copy.createDiv({ cls: "media-work-relation-option-title", text: group.title || group.file.name });
      copy.createDiv({
        cls: "media-work-relation-option-description",
        text: group.description
          ? String(group.description)
          : (isWorkOption ? `${group.media_type || "作品"} · ${group.release_date || "未知年份"}` : `${kind}页面`)
      });
      const arrow = option.createSpan({ cls: "media-work-relation-option-arrow" });
      try {
        if (typeof setIcon === "function") setIcon(arrow, "chevron-right");
      } catch (error) {
        arrow.setText("");
      }
      option.addEventListener("click", async () => {
        option.disabled = true;
        try {
          await onChoose(group);
          close();
        } catch (error) {
          console.error(`更新${kind}失败`, error);
          if (typeof Notice === "function") new Notice(`更新${kind}失败，请打开开发者控制台查看详情`);
          option.disabled = false;
        }
      });
    }
  };

  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) close();
  });
  search.addEventListener("input", renderOptions);
  document.addEventListener("keydown", onKeydown);
  renderOptions();
  window.setTimeout(() => search.focus(), 0);
};

const createLinkChip = ({ host, value, kind, onRemove }) => {
  const group = groupFor(value);
  const chip = host.createDiv({ cls: "media-work-relation-chip" });
  const link = chip.createEl("a", {
    cls: "internal-link",
    text: group?.title || plainText(value) || `未命名${kind}`
  });
  const href = group?.file.path || linkPath(value);
  link.setAttr("href", href);
  link.setAttr("data-href", href);
  const remove = chip.createEl("button", {
    cls: "media-work-relation-remove",
    attr: { type: "button", "aria-label": `移除${kind}「${group?.title || plainText(value)}」` }
  });
  setButtonIcon(remove, "x", "×");
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    try {
      await onRemove();
    } catch (error) {
      console.error(`移除${kind}失败`, error);
      if (typeof Notice === "function") new Notice(`移除${kind}失败，请打开开发者控制台查看详情`);
      remove.disabled = false;
    }
  });
};

const createWorkLinkChip = ({ host, value, onRemove }) => {
  const work = workFor(value);
  const chip = host.createDiv({ cls: "media-work-relation-chip" });
  const link = chip.createEl("a", {
    cls: "internal-link",
    text: work?.title || plainText(value) || "未命名作品"
  });
  const href = work?.file.path || linkPath(value);
  link.setAttr("href", href);
  link.setAttr("data-href", href);
  const remove = chip.createEl("button", {
    cls: "media-work-relation-remove",
    attr: { type: "button", "aria-label": `移除相关作品「${work?.title || plainText(value)}」` }
  });
  setButtonIcon(remove, "x", "×");
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    try {
      await onRemove();
    } catch (error) {
      console.error("移除相关作品失败", error);
      if (typeof Notice === "function") new Notice("移除相关作品失败，请打开开发者控制台查看详情");
      remove.disabled = false;
    }
  });
};

const render = () => {
  root.empty();

  const seriesRow = root.createDiv({ cls: "media-work-relation-row" });
  seriesRow.createSpan({ cls: "media-work-relation-label", text: "系列（单选）" });
  const seriesValues = seriesRow.createDiv({ cls: "media-work-relation-values" });
  if (currentSeries) {
    createLinkChip({
      host: seriesValues,
      value: currentSeries,
      kind: "系列",
      onRemove: async () => {
        await writeRelations(frontmatter => { frontmatter.series = ""; });
        currentSeries = "";
        render();
        if (typeof Notice === "function") new Notice("已清除系列");
      }
    });
  } else {
    seriesValues.createSpan({ cls: "media-work-relation-placeholder", text: "未设置" });
  }
  const chooseSeries = seriesRow.createEl("button", {
    cls: "media-work-relation-action",
    text: currentSeries ? "更换" : "选择",
    attr: { type: "button" }
  });
  chooseSeries.addEventListener("click", () => openPicker({
    kind: "系列",
    options: seriesOptions,
    onChoose: async group => {
      const value = `[[${group.file.name}]]`;
      const inheritedCollections = toArray(group.collections);
      const nextCollections = [...currentCollections];
      for (const collection of inheritedCollections) {
        if (!nextCollections.some(value => linkPath(value) === linkPath(collection))) {
          nextCollections.push(`[[${plainText(collection)}]]`);
        }
      }
      await writeRelations(frontmatter => {
        frontmatter.series = value;
        frontmatter.collections = nextCollections.map(item => `[[${plainText(item)}]]`);
      });
      currentSeries = value;
      currentCollections = nextCollections;
      render();
      if (typeof Notice === "function") new Notice(`已设置系列「${group.title || group.file.name}」`);
    }
  }));

  const collectionsRow = root.createDiv({ cls: "media-work-relation-row" });
  collectionsRow.createSpan({ cls: "media-work-relation-label", text: "合集（可多选）" });
  const collectionValues = collectionsRow.createDiv({ cls: "media-work-relation-values" });
  if (currentCollections.length) {
    for (const collection of currentCollections) {
      createLinkChip({
        host: collectionValues,
        value: collection,
        kind: "合集",
        onRemove: async () => {
          const next = currentCollections.filter(value => linkPath(value) !== linkPath(collection));
          await writeRelations(frontmatter => { frontmatter.collections = next.map(value => `[[${plainText(value)}]]`); });
          await syncSeriesCollection(groupFor(collection), next);
          currentCollections = next;
          render();
          if (typeof Notice === "function") new Notice(`已移除合集「${plainText(collection)}」`);
        }
      });
    }
  } else {
    collectionValues.createSpan({ cls: "media-work-relation-placeholder", text: "未设置" });
  }
  const addCollection = collectionsRow.createEl("button", {
    cls: "media-work-relation-action",
    text: "添加",
    attr: { type: "button" }
  });
  addCollection.addEventListener("click", () => openPicker({
    kind: "合集",
    options: collectionOptions,
    excluded: currentCollections,
    onChoose: async group => {
      const value = `[[${group.file.name}]]`;
      const next = [...currentCollections, value];
      await writeRelations(frontmatter => { frontmatter.collections = next.map(item => `[[${plainText(item)}]]`); });
      await syncSeriesCollection(group, next);
      currentCollections = next;
      render();
      if (typeof Notice === "function") new Notice(`已添加合集「${group.title || group.file.name}」`);
    }
  }));

  const relatedRow = root.createDiv({ cls: "media-work-relation-row is-related" });
  relatedRow.createSpan({ cls: "media-work-relation-label", text: "相关作品（双向）" });
  const relatedValues = relatedRow.createDiv({ cls: "media-work-relation-values" });
  if (currentRelated.length) {
    for (const related of currentRelated) {
      createWorkLinkChip({
        host: relatedValues,
        value: related,
        onRemove: async () => {
          const target = workFor(related);
          const next = currentRelated.filter(value => !target || !matchesWork(value, target));
          await setRelatedWorks(next);
          render();
          if (typeof Notice === "function") new Notice(`已双向移除相关作品「${target?.title || plainText(related)}」`);
        }
      });
    }
  } else {
    relatedValues.createSpan({ cls: "media-work-relation-placeholder", text: "未设置" });
  }
  const addRelated = relatedRow.createEl("button", {
    cls: "media-work-relation-action",
    text: "添加",
    attr: { type: "button" }
  });
  addRelated.addEventListener("click", () => openPicker({
    kind: "相关作品",
    options: allWorks
      .filter(work => work.file.path !== page.file.path)
      .sort((left, right) => String(left.title || left.file.name).localeCompare(String(right.title || right.file.name), "zh-Hans-CN")),
    excluded: currentRelated,
    onChoose: async work => {
      const next = [...currentRelated, workLink(work)];
      await setRelatedWorks(next);
      render();
      if (typeof Notice === "function") new Notice(`已双向关联「${work.title || work.file.name}」`);
    }
  }));
};

render();
