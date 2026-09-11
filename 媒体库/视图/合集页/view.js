const page = dv.current();

if (!page || page.note_type !== "media_collection") {
  return;
}

const typeLabels = {
  book: "图书",
  tv: "电视剧",
  movie: "电影",
  anime: "动漫",
  game: "游戏"
};

const kindLabels = {
  series: "系列",
  collection: "合集"
};

const toArray = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.array === "function") return value.array();
  return [value];
};

const showNotice = message => {
  if (typeof Notice === "function") new Notice(message);
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

const applyFrontmatterBatch = async (changes, failureLabel, checkHint) => {
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
      ? `${failureLabel}，自动恢复未完成：${rollbackFailures.join("、")}。请检查${checkHint}`
      : `${failureLabel}，本次修改已全部撤销`;
    throw wrapped;
  }
};

const plainText = value => {
  if (value === null || value === undefined || value === "") return "";
  if (value.path) return value.path.split("/").pop().replace(/\.md$/i, "");
  return String(value)
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .split("/")
    .pop()
    .replace(/\.md$/i, "");
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

const pointsToCurrent = value => {
  const target = linkPath(value);
  if (!target) return false;
  const currentPath = page.file.path.replace(/\.md$/i, "");
  return target === currentPath || target === page.file.name || target.endsWith(`/${page.file.name}`);
};

const pointsToPage = (value, targetPage) => {
  const target = linkPath(value);
  if (!target || !targetPage?.file) return false;
  const targetPath = targetPage.file.path.replace(/\.md$/i, "");
  return target === targetPath
    || target === targetPage.file.name
    || target.endsWith(`/${targetPage.file.name}`);
};

const resourceUrl = (value, sourcePath = page.file.path) => {
  const raw = value?.path ?? String(value || "");
  const target = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  if (!target) return "";
  const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  return file ? app.vault.getResourcePath(file) : "";
};

const yearText = value => {
  if (!value) return "";
  if (typeof value.toFormat === "function") return value.toFormat("yyyy");
  const match = String(value).match(/^\d{4}/);
  return match ? match[0] : String(value);
};

const releaseDateValue = value => {
  if (!value) return "\uffff";
  if (typeof value.toISODate === "function") return value.toISODate();
  return String(value);
};

const kind = kindLabels[page.collection_kind] || "合集";
const isSeries = page.collection_kind === "series";

const allGroups = dv.pages('"媒体库/合集"')
  .where(group => group.note_type === "media_collection")
  .array();
const seriesGroups = allGroups.filter(group => group.collection_kind === "series");

const parentCollections = isSeries
  ? allGroups.filter(group =>
      group.collection_kind === "collection"
      && toArray(page.collections).some(value => pointsToPage(value, group))
    )
  : [];

const allWorks = dv.pages('"媒体库/作品"')
  .where(work => work.note_type === "media")
  .array();

const linkedSeries = isSeries
  ? []
  : seriesGroups.filter(group => toArray(group.collections).some(pointsToCurrent));
const directMembers = isSeries
  ? []
  : allWorks.filter(work => toArray(work.collections).some(pointsToCurrent));
const inheritedSeriesFor = work => linkedSeries.filter(group => pointsToPage(work.series, group));
const inheritedMembers = isSeries
  ? []
  : allWorks.filter(work => inheritedSeriesFor(work).length > 0);
const memberMap = new Map(
  (isSeries ? allWorks.filter(work => pointsToCurrent(work.series)) : [...directMembers, ...inheritedMembers])
    .map(work => [work.file.path, work])
);
const members = [...memberMap.values()]
  .sort((left, right) => {
    const dateOrder = releaseDateValue(left.release_date).localeCompare(releaseDateValue(right.release_date));
    if (dateOrder !== 0) return dateOrder;
    return String(left.title || left.file.name).localeCompare(
      String(right.title || right.file.name),
      "zh-Hans-CN"
    );
  });

const title = page.title || page.file.name;
const currentGroupLink = `[[${page.file.name}]]`;
const defaultDescription = isSeries
  ? "按发布时间整理的系列作品。在作品的系列属性中关联本页后，会自动加入右侧列表。"
  : "成员由直接加入的作品与所属系列继承的作品共同组成，并按发布时间排列。";

const root = dv.container.createDiv({ cls: `media-collection-layout is-${page.collection_kind || "collection"}` });
const profile = root.createEl("aside", { cls: "media-collection-profile" });
const cover = profile.createDiv({ cls: "media-collection-cover" });
const coverUrl = resourceUrl(page.cover);

if (coverUrl) {
  const image = cover.createEl("img");
  image.setAttr("src", coverUrl);
  image.setAttr("alt", `${title}封面`);
} else {
  cover.createDiv({ cls: "media-collection-cover-empty", text: "尚未设置封面" });
}

profile.createDiv({ cls: "media-collection-kind", text: kind });
profile.createEl("h1", { cls: "media-collection-title", text: title });
profile.createDiv({ cls: "media-collection-description", text: page.description ? String(page.description) : defaultDescription });
const memberCount = profile.createDiv({ cls: "media-collection-count", text: `${members.length} 部作品` });

if (isSeries) {
  const parents = profile.createDiv({ cls: "media-collection-parents" });
  parents.createSpan({ cls: "media-collection-parents-label", text: "所属合集" });
  if (parentCollections.length) {
    const links = parents.createDiv({ cls: "media-collection-parent-links" });
    for (const collection of parentCollections) {
      const link = links.createEl("a", {
        cls: "internal-link",
        text: collection.title || collection.file.name
      });
      link.setAttr("href", collection.file.path);
      link.setAttr("data-href", collection.file.path);
    }
  } else {
    parents.createSpan({ cls: "media-collection-parents-empty", text: "暂未加入合集" });
  }
}

const visualControls = profile.createDiv({ cls: "media-collection-visual-controls" });

const mountImageControl = ({ field, folder, noun, hasValue }) => {
  const control = visualControls.createDiv({ cls: "media-collection-image-control" });
  const mountHost = control.createDiv({ cls: "media-collection-image-mount" });
  try {
    const metaBind = app.plugins.getPlugin("obsidian-meta-bind-plugin");
    const declaration = `INPUT[imageSuggester(optionQuery("${folder}"), title(选择${noun})): ${field}]`
      .replace(": ", ":");
    const fieldType = metaBind?.api?.isInlineFieldDeclarationAndGetType(declaration);
    if (!metaBind?.api || !fieldType) throw new Error("Meta Bind API unavailable");
    const mountable = metaBind.api.createInlineFieldOfTypeFromString(fieldType, declaration, page.file.path);
    mountable.mount(mountHost);
    mountHost.metaBindMountable = mountable;

    const label = hasValue ? `更换${noun}` : `选择${noun}`;
    const button = control.createEl("button", {
      cls: "media-collection-image-trigger",
      text: label,
      attr: { type: "button", "aria-label": label }
    });

    button.addEventListener("click", () => {
      const imageField = mountable.inputField;
      if (typeof imageField?.openModal === "function") {
        imageField.openModal();
        return;
      }

      const emptyTrigger = mountHost.querySelector(".mb-image-empty button");
      if (emptyTrigger) {
        emptyTrigger.click();
        return;
      }

      console.error(`${noun}选择器无法直接打开：当前 Meta Bind 版本缺少图片字段接口`);
    });
  } catch (error) {
    mountHost.remove();
    control.createSpan({ cls: "media-collection-control-fallback", text: `请在属性中更换${noun}` });
    console.error(`${noun}选择器加载失败`, error);
  }
};

mountImageControl({
  field: "cover",
  folder: "媒体库/合集/封面",
  noun: "封面",
  hasValue: Boolean(coverUrl)
});

mountImageControl({
  field: "backdrop",
  folder: "媒体库/合集/横幅",
  noun: "横幅",
  hasValue: Boolean(resourceUrl(page.backdrop))
});

const content = root.createDiv({ cls: "media-collection-members" });
const header = content.createDiv({ cls: "media-collection-members-header" });
header.createEl("h2", { text: isSeries ? "系列作品" : "合集成员" });
const headerActions = header.createDiv({ cls: "media-collection-members-actions" });
const addWorks = headerActions.createEl("button", {
  cls: "media-collection-add-works",
  text: isSeries ? "添加作品" : "直接添加作品",
  attr: { type: "button" }
});
const manageSeries = isSeries ? null : headerActions.createEl("button", {
  cls: "media-collection-add-works",
  text: "管理系列",
  attr: { type: "button" }
});
const manageMembers = header.createEl("button", {
  cls: "media-collection-manage-members",
  text: "管理作品",
  attr: { type: "button" }
});
headerActions.appendChild(manageMembers);

const openManageSeriesModal = () => {
  if (isSeries) return;
  const initiallyLinked = new Set(linkedSeries.map(group => group.file.path));
  const selected = new Set(initiallyLinked);
  const overlay = document.body.createDiv({ cls: "media-collection-add-overlay modal-container" });
  const modal = overlay.createDiv({
    cls: "media-collection-add-modal modal",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": `管理合集「${title}」包含的系列` }
  });
  const closeButton = modal.createEl("button", {
    cls: "modal-close-button",
    attr: { type: "button", "aria-label": "关闭" }
  });
  const closeIcon = closeButton.createSpan({ cls: "media-collection-add-close-icon" });
  try {
    if (typeof setIcon === "function") setIcon(closeIcon, "x");
    else closeIcon.setText("×");
  } catch (error) {
    closeIcon.setText("×");
  }

  const contentEl = modal.createDiv({ cls: "modal-content" });
  contentEl.createEl("h1", { cls: "modal-title", text: `管理「${title}」包含的系列` });
  contentEl.createDiv({
    cls: "media-collection-add-description",
    text: "勾选的系列会把全部成员带入当前合集；取消后，这些作品不再通过该系列继承，但作品自己直接加入的关系不受影响。"
  });
  const search = contentEl.createEl("input", {
    cls: "media-collection-add-search",
    attr: { type: "search", placeholder: "搜索系列…", "aria-label": "搜索系列" }
  });
  const list = contentEl.createDiv({ cls: "media-collection-add-list", attr: { role: "list" } });
  const footer = contentEl.createDiv({ cls: "media-collection-add-footer" });
  const selectionCount = footer.createSpan({ cls: "media-collection-add-count" });
  const footerActions = footer.createDiv({ cls: "media-collection-add-footer-actions" });
  const cancel = footerActions.createEl("button", { text: "取消", attr: { type: "button" } });
  const confirm = footerActions.createEl("button", { cls: "mod-cta", text: "保存", attr: { type: "button" } });
  let isSaving = false;

  const closeModal = () => {
    if (isSaving) return;
    document.removeEventListener("keydown", handleModalKeydown);
    overlay.remove();
  };
  const handleModalKeydown = event => {
    if (event.key === "Escape") closeModal();
  };
  const setModalSaving = saving => {
    isSaving = saving;
    overlay.setAttr("aria-busy", String(saving));
    closeButton.disabled = saving;
    cancel.disabled = saving;
    search.disabled = saving;
    for (const checkbox of list.querySelectorAll('input[type="checkbox"]')) checkbox.disabled = saving;
  };
  const updateSelection = () => selectionCount.setText(`已选择 ${selected.size} 个系列`);
  const renderCandidates = () => {
    list.empty();
    const query = search.value.trim().toLocaleLowerCase("zh-Hans-CN");
    const visible = seriesGroups.filter(group => {
      const searchable = [group.title, group.file.name, group.description]
        .filter(Boolean).join(" ").toLocaleLowerCase("zh-Hans-CN");
      return !query || searchable.includes(query);
    });
    if (!visible.length) {
      list.createDiv({ cls: "media-collection-add-empty", text: "没有找到匹配的系列" });
      return;
    }
    for (const group of visible) {
      const row = list.createEl("label", { cls: "media-collection-add-item", attr: { role: "listitem" } });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = selected.has(group.file.path);
      const copy = row.createDiv({ cls: "media-collection-add-item-copy" });
      copy.createDiv({ cls: "media-collection-add-item-title", text: group.title || group.file.name });
      const memberTotal = allWorks.filter(work => pointsToPage(work.series, group)).length;
      copy.createDiv({ cls: "media-collection-add-item-meta", text: `${memberTotal} 部系列作品` });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(group.file.path);
        else selected.delete(group.file.path);
        row.classList.toggle("is-selected", checkbox.checked);
        updateSelection();
      });
      row.classList.toggle("is-selected", checkbox.checked);
    }
  };

  search.addEventListener("input", renderCandidates);
  closeButton.addEventListener("click", closeModal);
  cancel.addEventListener("click", closeModal);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeModal();
  });
  confirm.addEventListener("click", async () => {
    if (isSaving) return;
    confirm.disabled = true;
    confirm.setText("正在保存…");
    setModalSaving(true);
    try {
      const changes = [];
      for (const group of seriesGroups) {
        const wasLinked = initiallyLinked.has(group.file.path);
        const shouldLink = selected.has(group.file.path);
        if (wasLinked === shouldLink) continue;
        const seriesFile = app.vault.getFileByPath(group.file.path);
        if (!seriesFile) {
          const missing = new Error(`没有找到系列文件：${group.file.path}`);
          missing.userMessage = `无法保存：没有找到系列「${group.title || group.file.name}」的文件`;
          throw missing;
        }
        changes.push({
          file: seriesFile,
          field: "collections",
          label: group.title || group.file.name,
          update: frontmatter => {
            const existing = Array.isArray(frontmatter.collections)
              ? [...frontmatter.collections]
              : (frontmatter.collections ? [frontmatter.collections] : []);
            const withoutCurrent = existing.filter(value => !pointsToCurrent(value));
            frontmatter.collections = shouldLink ? [...withoutCurrent, currentGroupLink] : withoutCurrent;
          }
        });
      }
      await applyFrontmatterBatch(changes, "合集包含的系列保存失败", "这些系列的“所属合集”属性");
      setModalSaving(false);
      closeModal();
      showNotice(`已更新合集「${title}」包含的系列`);
    } catch (error) {
      console.error("更新合集系列失败", error);
      showNotice(error?.userMessage || "合集包含的系列保存失败，原内容未改变");
      setModalSaving(false);
      confirm.disabled = false;
      confirm.setText("重新保存");
    }
  });

  renderCandidates();
  updateSelection();
  document.addEventListener("keydown", handleModalKeydown);
  window.setTimeout(() => search.focus(), 0);
};

manageSeries?.addEventListener("click", openManageSeriesModal);

const openAddWorksModal = () => {
  const memberPaths = new Set((isSeries ? members : directMembers).map(member => member.file.path));
  const candidates = allWorks
    .filter(work => !memberPaths.has(work.file.path))
    .sort((left, right) => String(left.title || left.file.name).localeCompare(
      String(right.title || right.file.name),
      "zh-Hans-CN"
    ));
  const selected = new Set();
  const overlay = document.body.createDiv({ cls: "media-collection-add-overlay modal-container" });
  const modal = overlay.createDiv({
    cls: "media-collection-add-modal modal",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": `添加作品到${kind}「${title}」` }
  });
  const closeButton = modal.createEl("button", {
    cls: "modal-close-button",
    attr: { type: "button", "aria-label": "关闭" }
  });
  const closeIcon = closeButton.createSpan({ cls: "media-collection-add-close-icon" });
  try {
    if (typeof setIcon === "function") setIcon(closeIcon, "x");
    else closeIcon.setText("×");
  } catch (error) {
    closeIcon.setText("×");
  }
  const contentEl = modal.createDiv({ cls: "modal-content" });
  contentEl.createEl("h1", { cls: "modal-title", text: `添加作品到${kind}「${title}」` });

  contentEl.createDiv({
    cls: "media-collection-add-description",
    text: isSeries
      ? "选择尚未归入其他系列的作品。已有系列不会被直接覆盖。"
      : "这里添加的是作品自己的直接归属，不会改变其系列或系列所属合集。"
  });
  const search = contentEl.createEl("input", {
    cls: "media-collection-add-search",
    attr: {
      type: "search",
      placeholder: "搜索作品名称、类型或年份…",
      "aria-label": "搜索可添加的作品"
    }
  });
  const list = contentEl.createDiv({
    cls: "media-collection-add-list",
    attr: { role: "list", "aria-label": "可添加的作品" }
  });
  const footer = contentEl.createDiv({ cls: "media-collection-add-footer" });
  const selectionCount = footer.createSpan({ cls: "media-collection-add-count", text: "已选择 0 部" });
  const footerActions = footer.createDiv({ cls: "media-collection-add-footer-actions" });
  const cancel = footerActions.createEl("button", { text: "取消", attr: { type: "button" } });
  const confirm = footerActions.createEl("button", {
    cls: "mod-cta",
    text: "添加",
    attr: { type: "button", disabled: "" }
  });
  let isSaving = false;

  const closeModal = () => {
    if (isSaving) return;
    document.removeEventListener("keydown", handleModalKeydown);
    overlay.remove();
  };
  const handleModalKeydown = event => {
    if (event.key === "Escape") closeModal();
  };

  const updateSelection = () => {
    selectionCount.setText(`已选择 ${selected.size} 部`);
    confirm.disabled = isSaving || selected.size === 0;
  };

  const setModalSaving = saving => {
    isSaving = saving;
    overlay.setAttr("aria-busy", String(saving));
    closeButton.disabled = saving;
    cancel.disabled = saving;
    search.disabled = saving;
    for (const checkbox of list.querySelectorAll('input[type="checkbox"]')) {
      checkbox.disabled = saving || checkbox.dataset.blocked === "true";
    }
    updateSelection();
  };

  const renderCandidates = () => {
    list.empty();
    const query = search.value.trim().toLocaleLowerCase("zh-Hans-CN");
    const visible = candidates.filter(work => {
      const searchable = [
        work.title,
        work.file.name,
        work.original_title,
        typeLabels[work.media_type] || work.media_type,
        yearText(work.release_date),
        plainText(work.series)
      ].filter(Boolean).join(" ").toLocaleLowerCase("zh-Hans-CN");
      return !query || searchable.includes(query);
    });

    if (!visible.length) {
      list.createDiv({
        cls: "media-collection-add-empty",
        text: candidates.length
          ? "没有找到匹配的作品"
          : (isSeries ? "所有可选作品都已在当前系列中" : "所有作品都已直接加入当前合集")
      });
      return;
    }

    for (const work of visible) {
      const existingSeries = plainText(work.series);
      const blocked = isSeries && Boolean(existingSeries);
      const row = list.createEl("label", {
        cls: `media-collection-add-item${blocked ? " is-disabled" : ""}`,
        attr: { role: "listitem" }
      });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = selected.has(work.file.path);
      checkbox.disabled = blocked;
      checkbox.dataset.blocked = String(blocked);

      const copy = row.createDiv({ cls: "media-collection-add-item-copy" });
      copy.createDiv({ cls: "media-collection-add-item-title", text: work.title || work.file.name });
      const facts = [typeLabels[work.media_type] || work.media_type, yearText(work.release_date)].filter(Boolean);
      if (blocked) facts.push(`已有系列：${existingSeries}`);
      if (!isSeries) {
        const inheritedFrom = inheritedSeriesFor(work);
        if (inheritedFrom.length) {
          facts.push(`当前继承自${inheritedFrom.map(group => group.title || group.file.name).join("、")}`);
        }
      }
      copy.createDiv({ cls: "media-collection-add-item-meta", text: facts.join(" · ") || "作品" });

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(work.file.path);
        else selected.delete(work.file.path);
        row.classList.toggle("is-selected", checkbox.checked);
        updateSelection();
      });
      row.classList.toggle("is-selected", checkbox.checked);
    }
  };

  search.addEventListener("input", renderCandidates);
  closeButton.addEventListener("click", closeModal);
  cancel.addEventListener("click", closeModal);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeModal();
  });
  confirm.addEventListener("click", async () => {
    if (!selected.size || isSaving) return;
    confirm.disabled = true;
    confirm.setText("正在添加…");
    setModalSaving(true);

    try {
      const changes = [];
      for (const path of [...selected]) {
        const workFile = app.vault.getFileByPath(path);
        const work = allWorks.find(candidate => candidate.file.path === path);
        if (!workFile) {
          const missing = new Error(`没有找到作品文件：${path}`);
          missing.userMessage = `无法添加：没有找到作品「${work?.title || work?.file.name || path}」的文件`;
          throw missing;
        }
        changes.push({
          file: workFile,
          field: isSeries ? "series" : "collections",
          label: work?.title || work?.file.name || path,
          update: frontmatter => {
            if (isSeries) {
              frontmatter.series = currentGroupLink;
            } else {
              const existing = Array.isArray(frontmatter.collections)
                ? [...frontmatter.collections]
                : (frontmatter.collections ? [frontmatter.collections] : []);
              if (!existing.some(pointsToCurrent)) existing.push(currentGroupLink);
              frontmatter.collections = existing;
            }
          }
        });
      }
      await applyFrontmatterBatch(changes, `添加作品到${kind}失败`, `这些作品的“${isSeries ? "系列" : "直接加入"}”属性`);

      showNotice(`已将 ${changes.length} 部作品添加到${kind}「${title}」`);
      setModalSaving(false);
      closeModal();
    } catch (error) {
      console.error(`添加作品到${kind}失败`, error);
      showNotice(error?.userMessage || `添加作品到${kind}失败，原内容未改变`);
      setModalSaving(false);
      confirm.setText("重新添加");
      updateSelection();
    }
  });

  renderCandidates();
  document.addEventListener("keydown", handleModalKeydown);
  window.setTimeout(() => search.focus(), 0);
};

addWorks.addEventListener("click", openAddWorksModal);

const openManageMembersModal = () => {
  const selected = new Set();
  const overlay = document.body.createDiv({ cls: "media-collection-add-overlay modal-container" });
  const modal = overlay.createDiv({
    cls: "media-collection-add-modal modal",
    attr: { role: "dialog", "aria-modal": "true", "aria-label": `管理${kind}「${title}」中的作品` }
  });
  const closeButton = modal.createEl("button", {
    cls: "modal-close-button",
    attr: { type: "button", "aria-label": "关闭" }
  });
  const closeIcon = closeButton.createSpan({ cls: "media-collection-add-close-icon" });
  try {
    if (typeof setIcon === "function") setIcon(closeIcon, "x");
    else closeIcon.setText("×");
  } catch (error) {
    closeIcon.setText("×");
  }

  const contentEl = modal.createDiv({ cls: "modal-content" });
  contentEl.createEl("h1", { cls: "modal-title", text: `管理「${title}」中的作品` });
  contentEl.createDiv({
    cls: "media-collection-add-description",
    text: isSeries
      ? "搜索并勾选要移出当前系列的作品，可以一次处理多部。"
      : "搜索并勾选要移除直接归属的作品；灰色项由系列继承，请通过“管理系列”调整。"
  });
  const search = contentEl.createEl("input", {
    cls: "media-collection-add-search",
    attr: { type: "search", placeholder: "搜索当前作品…", "aria-label": "搜索当前作品" }
  });
  const list = contentEl.createDiv({
    cls: "media-collection-add-list",
    attr: { role: "list", "aria-label": "当前作品" }
  });
  const footer = contentEl.createDiv({ cls: "media-collection-add-footer" });
  const selectionCount = footer.createSpan({ cls: "media-collection-add-count" });
  const footerActions = footer.createDiv({ cls: "media-collection-add-footer-actions" });
  const cancel = footerActions.createEl("button", { text: "取消", attr: { type: "button" } });
  const confirm = footerActions.createEl("button", {
    cls: "mod-warning",
    text: "移出",
    attr: { type: "button", disabled: "" }
  });
  let isSaving = false;

  const closeModal = () => {
    if (isSaving) return;
    document.removeEventListener("keydown", handleModalKeydown);
    overlay.remove();
  };
  const handleModalKeydown = event => {
    if (event.key === "Escape") closeModal();
  };
  const updateSelection = () => {
    const count = selected.size;
    selectionCount.setText(count ? `已选择 ${count} 部待移出` : "尚未选择要移出的作品");
    confirm.setText(isSaving ? "正在移出…" : (count ? `移出 ${count} 部` : "移出"));
    confirm.disabled = isSaving || count === 0;
  };
  const setModalSaving = saving => {
    isSaving = saving;
    overlay.setAttr("aria-busy", String(saving));
    closeButton.disabled = saving;
    cancel.disabled = saving;
    search.disabled = saving;
    for (const checkbox of list.querySelectorAll('input[type="checkbox"]')) {
      checkbox.disabled = saving || checkbox.dataset.blocked === "true";
    }
    updateSelection();
  };

  const renderMembers = () => {
    list.empty();
    const query = search.value.trim().toLocaleLowerCase("zh-Hans-CN");
    const visible = members.filter(member => {
      const inheritedFrom = isSeries ? [] : inheritedSeriesFor(member);
      const isDirectMember = isSeries || toArray(member.collections).some(pointsToCurrent);
      const origin = isDirectMember
        ? (inheritedFrom.length ? "直接加入 系列继承" : (isSeries ? "当前系列" : "直接加入"))
        : "系列继承";
      const searchable = [
        member.title,
        member.file.name,
        member.original_title,
        typeLabels[member.media_type] || member.media_type,
        yearText(member.release_date),
        plainText(member.series),
        origin
      ].filter(Boolean).join(" ").toLocaleLowerCase("zh-Hans-CN");
      return !query || searchable.includes(query);
    });

    if (!visible.length) {
      list.createDiv({
        cls: "media-collection-add-empty",
        text: members.length ? "没有找到匹配的作品" : `当前${kind}还没有作品`
      });
      return;
    }

    for (const member of visible) {
      const inheritedFrom = isSeries ? [] : inheritedSeriesFor(member);
      const isDirectMember = isSeries || toArray(member.collections).some(pointsToCurrent);
      const blocked = !isDirectMember;
      const row = list.createEl("label", {
        cls: `media-collection-add-item${blocked ? " is-disabled is-inherited" : ""}`,
        attr: { role: "listitem" }
      });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = selected.has(member.file.path);
      checkbox.disabled = blocked;
      checkbox.dataset.blocked = String(blocked);

      const copy = row.createDiv({ cls: "media-collection-add-item-copy" });
      copy.createDiv({ cls: "media-collection-add-item-title", text: member.title || member.file.name });
      const facts = [typeLabels[member.media_type] || member.media_type, yearText(member.release_date)].filter(Boolean);
      if (blocked) {
        facts.push(`继承自${inheritedFrom.map(group => group.title || group.file.name).join("、")} · 请通过“管理系列”调整`);
      } else if (inheritedFrom.length) {
        facts.push(`直接加入，同时继承自${inheritedFrom.map(group => group.title || group.file.name).join("、")}`);
      } else {
        facts.push(isSeries ? "当前系列作品" : "直接加入");
      }
      copy.createDiv({ cls: "media-collection-add-item-meta", text: facts.join(" · ") });

      if (!blocked) {
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(member.file.path);
          else selected.delete(member.file.path);
          row.classList.toggle("is-selected", checkbox.checked);
          updateSelection();
        });
      }
      row.classList.toggle("is-selected", checkbox.checked);
    }
  };

  search.addEventListener("input", renderMembers);
  closeButton.addEventListener("click", closeModal);
  cancel.addEventListener("click", closeModal);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeModal();
  });
  confirm.addEventListener("click", async () => {
    if (!selected.size || isSaving) return;
    setModalSaving(true);
    try {
      const changes = [];
      for (const path of [...selected]) {
        const member = members.find(candidate => candidate.file.path === path);
        const workFile = app.vault.getFileByPath(path);
        if (!workFile) {
          const missing = new Error(`没有找到作品文件：${path}`);
          missing.userMessage = `无法移出：没有找到作品「${member?.title || member?.file.name || path}」的文件`;
          throw missing;
        }
        changes.push({
          file: workFile,
          field: isSeries ? "series" : "collections",
          label: member?.title || member?.file.name || path,
          update: frontmatter => {
            if (isSeries) {
              if (pointsToCurrent(frontmatter.series)) frontmatter.series = "";
              return;
            }
            const existing = Array.isArray(frontmatter.collections)
              ? [...frontmatter.collections]
              : (frontmatter.collections ? [frontmatter.collections] : []);
            frontmatter.collections = existing.filter(value => !pointsToCurrent(value));
          }
        });
      }

      await applyFrontmatterBatch(changes, `从${kind}移出作品失败`, `这些作品的“${isSeries ? "系列" : "直接加入"}”属性`);
      showNotice(`已从${kind}「${title}」移出 ${changes.length} 部作品`);
      setModalSaving(false);
      closeModal();
    } catch (error) {
      console.error(`从${kind}批量移出作品失败`, error);
      showNotice(error?.userMessage || `从${kind}移出作品失败，原内容未改变`);
      setModalSaving(false);
    }
  });

  renderMembers();
  updateSelection();
  document.addEventListener("keydown", handleModalKeydown);
  window.setTimeout(() => search.focus(), 0);
};

manageMembers.addEventListener("click", openManageMembersModal);

const timeline = content.createDiv({ cls: "media-collection-timeline" });

if (!members.length) {
  const empty = timeline.createDiv({ cls: "media-collection-empty" });
  empty.createEl("strong", { text: "还没有成员" });
  empty.createDiv({ text: isSeries ? "点击“添加作品”即可把作品加入当前系列。" : "点击“添加作品”即可把作品直接收录到当前合集。" });
}

members.forEach((member, index) => {
  const inheritedFrom = isSeries ? [] : inheritedSeriesFor(member);
  const isDirectMember = !isSeries && toArray(member.collections).some(pointsToCurrent);
  const item = timeline.createDiv({ cls: "media-collection-member" });
  const order = item.createDiv({ cls: "media-collection-member-order" });
  order.createSpan({ text: String(index + 1).padStart(2, "0") });

  const posterLink = item.createEl("a", { cls: "media-collection-member-poster internal-link" });
  posterLink.setAttr("href", member.file.path);
  posterLink.setAttr("data-href", member.file.path);
  const posterUrl = resourceUrl(member.cover, member.file.path);
  if (posterUrl) {
    const image = posterLink.createEl("img");
    image.setAttr("src", posterUrl);
    image.setAttr("alt", `${member.title || member.file.name}封面`);
  } else {
    posterLink.createSpan({ text: typeLabels[member.media_type] || "作品" });
  }

  const copy = item.createDiv({ cls: "media-collection-member-copy" });
  const titleLink = copy.createEl("a", {
    cls: "media-collection-member-title internal-link",
    text: member.title || member.file.name
  });
  titleLink.setAttr("href", member.file.path);
  titleLink.setAttr("data-href", member.file.path);

  const chips = copy.createDiv({ cls: "media-collection-member-chips" });
  if (member.media_type) chips.createSpan({
    cls: `is-type is-${member.media_type}`,
    text: typeLabels[member.media_type] || member.media_type
  });
  if (member.status) chips.createSpan({ cls: "is-status", text: plainText(member.status) });
  if (isDirectMember) chips.createSpan({ cls: "is-origin is-direct", text: "直接加入" });
  if (inheritedFrom.length) chips.createSpan({
    cls: "is-origin is-inherited",
    text: `继承自${inheritedFrom.map(group => group.title || group.file.name).join("、")}`
  });

  const meta = copy.createDiv({ cls: "media-collection-member-meta" });
  const year = yearText(member.release_date);
  if (year) meta.createSpan({ text: year });
  if (typeof member.rating === "number" && member.rating > 0) meta.createSpan({ cls: "is-rating", text: `${member.rating} ★` });

  const open = copy.createEl("a", { cls: "media-collection-member-open internal-link", text: "打开作品" });
  open.setAttr("href", member.file.path);
  open.setAttr("data-href", member.file.path);

});
