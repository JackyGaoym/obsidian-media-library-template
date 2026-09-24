const page = dv.current();
const typeController = window.__mediaLibraryTypeControllers?.get(app.vault.getName());
const typeLabels = Object.fromEntries((typeController?.getTypes() || []).map(type => [type.id, type.label]));

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

const showNotice = message => {
  if (typeof Notice === "function") new Notice(message);
};

const showSaveError = (error, fallback) => {
  showNotice(error?.userMessage || fallback);
};

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

const inheritedCollections = () => {
  const seriesGroup = groupFor(currentSeries);
  return seriesGroup ? normalizeLinks(seriesGroup.collections, groupFor, group => `[[${group.file.name}]]`) : [];
};

const writeRelations = async updater => {
  if (!workFile) throw new Error("没有找到当前作品文件");
  await app.fileManager.processFrontMatter(workFile, updater);
};

const cloneValue = value => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") return { ...value };
  return value;
};

const snapshotField = (frontmatter, field) => ({
  exists: Object.prototype.hasOwnProperty.call(frontmatter, field),
  value: cloneValue(frontmatter[field])
});

const restoreField = (frontmatter, field, snapshot) => {
  if (snapshot.exists) frontmatter[field] = cloneValue(snapshot.value);
  else delete frontmatter[field];
};

const applyFrontmatterBatch = async (changes, failureLabel) => {
  const attempted = [];
  try {
    for (const change of changes) {
      let record = null;
      try {
        await app.fileManager.processFrontMatter(change.file, frontmatter => {
          record = { change, snapshot: snapshotField(frontmatter, change.field) };
          change.update(frontmatter);
        });
      } catch (error) {
        if (record) attempted.push(record);
        throw error;
      }
      attempted.push(record);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const record of [...attempted].reverse()) {
      try {
        await app.fileManager.processFrontMatter(record.change.file, frontmatter => {
          restoreField(frontmatter, record.change.field, record.snapshot);
        });
      } catch (rollbackError) {
        rollbackFailures.push(record.change.label);
        console.error(`恢复「${record.change.label}」失败`, rollbackError);
      }
    }

    const wrapped = new Error(failureLabel);
    wrapped.cause = error;
    wrapped.userMessage = rollbackFailures.length
      ? `${failureLabel}，自动恢复未完成：${rollbackFailures.join("、")}。请检查这些作品的“相关作品”属性`
      : `${failureLabel}，本次修改已撤销`;
    throw wrapped;
  }
};

const setRelatedWorks = async nextRelated => {
  const currentWork = allWorks.find(work => work.file.path === page.file.path);
  if (!currentWork) throw new Error("没有在媒体库中找到当前作品");

  const before = currentRelated.map(workFor).filter(Boolean);
  const after = nextRelated.map(workFor).filter(Boolean);
  const beforePaths = new Set(before.map(work => work.file.path));
  const afterPaths = new Set(after.map(work => work.file.path));
  const changes = [];

  if (!workFile) throw new Error("没有找到当前作品文件");
  changes.push({
    file: workFile,
    field: "related",
    label: currentWork.title || currentWork.file.name,
    next: after.map(workLink),
    update: frontmatter => { frontmatter.related = after.map(workLink); }
  });

  for (const target of after) {
    if (beforePaths.has(target.file.path)) continue;
    const targetFile = app.vault.getFileByPath(target.file.path);
    if (!targetFile) throw new Error(`没有找到作品文件：${target.file.path}`);
    const change = {
      file: targetFile,
      field: "related",
      label: target.title || target.file.name,
      update: null
    };
    change.update = frontmatter => {
      const next = normalizeLinks(frontmatter.related, workFor, workLink)
        .filter(value => !matchesWork(value, currentWork));
      next.push(workLink(currentWork));
      frontmatter.related = next;
    };
    changes.push(change);
  }
  for (const target of before) {
    if (afterPaths.has(target.file.path)) continue;
    const targetFile = app.vault.getFileByPath(target.file.path);
    if (!targetFile) throw new Error(`没有找到作品文件：${target.file.path}`);
    const change = {
      file: targetFile,
      field: "related",
      label: target.title || target.file.name,
      update: null
    };
    change.update = frontmatter => {
      frontmatter.related = normalizeLinks(frontmatter.related, workFor, workLink)
        .filter(value => !matchesWork(value, currentWork));
    };
    changes.push(change);
  }

  await applyFrontmatterBatch(changes, "相关作品保存失败");
  currentRelated = after.map(workLink);
};

const openPicker = ({ kind, options, excluded = [], onChoose }) => {
  const excludedPaths = new Set(excluded.map(linkPath));
  const trigger = document.activeElement;
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
    if (trigger?.isConnected && typeof trigger.focus === "function") trigger.focus();
  };
  const onKeydown = event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')]
      .filter(element => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      closeButton.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
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
          : (isWorkOption ? `${typeLabels[group.media_type] || group.media_type || "作品"} · ${group.release_date || "未知年份"}` : `${kind}页面`)
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
          showSaveError(error, `更新${kind}失败，原内容未改变`);
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

const createLinkChip = ({ host, value, kind, onRemove, inherited = false }) => {
  const group = groupFor(value);
  const chip = host.createDiv({
    cls: `media-work-relation-chip${inherited ? " is-inherited" : ""}`,
    attr: inherited ? { title: "由当前系列继承；更换或移出系列时会自动变化" } : {}
  });
  const link = chip.createEl("a", {
    cls: "internal-link",
    text: group?.title || plainText(value) || `未命名${kind}`
  });
  const href = group?.file.path || linkPath(value);
  link.setAttr("href", href);
  link.setAttr("data-href", href);
  if (!onRemove) return;
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
      showSaveError(error, `移除${kind}失败，原内容未改变`);
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
      showSaveError(error, "移除相关作品失败，原关联关系未改变");
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
      await writeRelations(frontmatter => {
        frontmatter.series = value;
      });
      currentSeries = value;
      render();
      if (typeof Notice === "function") new Notice(`已设置系列「${group.title || group.file.name}」`);
    }
  }));

  const inheritedRow = root.createDiv({ cls: "media-work-relation-row is-inherited" });
  inheritedRow.createSpan({ cls: "media-work-relation-label", text: "系列继承" });
  const inheritedValues = inheritedRow.createDiv({ cls: "media-work-relation-values" });
  const inherited = inheritedCollections();
  if (inherited.length) {
    for (const collection of inherited) {
      createLinkChip({
        host: inheritedValues,
        value: collection,
        kind: "合集",
        inherited: true
      });
    }
  } else {
    inheritedValues.createSpan({
      cls: "media-work-relation-placeholder",
      text: currentSeries ? "当前系列未加入合集" : "设置系列后自动显示"
    });
  }

  const collectionsRow = root.createDiv({ cls: "media-work-relation-row" });
  collectionsRow.createSpan({ cls: "media-work-relation-label", text: "直接加入" });
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
