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

const parentCollections = isSeries
  ? allGroups.filter(group =>
      group.collection_kind === "collection"
      && toArray(page.collections).some(value => pointsToPage(value, group))
    )
  : [];

const allWorks = dv.pages('"媒体库/作品"')
  .where(work => work.note_type === "media")
  .array();

const members = allWorks
  .filter(work => {
    if (isSeries) return pointsToCurrent(work.series);
    return toArray(work.collections).some(pointsToCurrent);
  })
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
  : "围绕共同主题收录的作品。成员会按发布时间自动排列。";

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
  text: "添加作品",
  attr: { type: "button" }
});
const editOrder = header.createEl("button", {
  cls: "media-collection-edit-order",
  text: "管理成员",
  attr: { type: "button" }
});
headerActions.appendChild(editOrder);

const openAddWorksModal = () => {
  const memberPaths = new Set(members.map(member => member.file.path));
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
      : "可一次选择多部作品；完整加入某个系列时，会自动绑定系列与合集。"
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

  const closeModal = () => {
    document.removeEventListener("keydown", handleModalKeydown);
    overlay.remove();
  };
  const handleModalKeydown = event => {
    if (event.key === "Escape") closeModal();
  };

  const updateSelection = () => {
    selectionCount.setText(`已选择 ${selected.size} 部`);
    confirm.disabled = selected.size === 0;
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
        text: candidates.length ? "没有找到匹配的作品" : `所有作品都已在当前${kind}中`
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

      const copy = row.createDiv({ cls: "media-collection-add-item-copy" });
      copy.createDiv({ cls: "media-collection-add-item-title", text: work.title || work.file.name });
      const facts = [typeLabels[work.media_type] || work.media_type, yearText(work.release_date)].filter(Boolean);
      if (blocked) facts.push(`已有系列：${existingSeries}`);
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
    if (!selected.size) return;
    confirm.disabled = true;
    confirm.setText("正在添加…");

    try {
      let added = 0;
      const prospectiveMemberPaths = new Set([...memberPaths, ...selected]);
      for (const path of selected) {
        const workFile = app.vault.getFileByPath(path);
        if (!workFile) continue;
        await app.fileManager.processFrontMatter(workFile, frontmatter => {
          if (isSeries) {
            frontmatter.series = currentGroupLink;
            const existing = Array.isArray(frontmatter.collections)
              ? [...frontmatter.collections]
              : (frontmatter.collections ? [frontmatter.collections] : []);
            for (const parent of toArray(page.collections)) {
              if (!existing.some(value => linkPath(value) === linkPath(parent))) {
                existing.push(`[[${plainText(parent)}]]`);
              }
            }
            frontmatter.collections = existing;
          } else {
            const existing = Array.isArray(frontmatter.collections)
              ? [...frontmatter.collections]
              : (frontmatter.collections ? [frontmatter.collections] : []);
            if (!existing.some(pointsToCurrent)) existing.push(currentGroupLink);
            frontmatter.collections = existing;
          }
        });
        added += 1;
      }

      let linkedSeriesCount = 0;
      if (!isSeries) {
        const seriesToLink = allGroups.filter(group => {
          if (group.collection_kind !== "series") return false;
          const seriesMembers = allWorks.filter(work => pointsToPage(work.series, group));
          return seriesMembers.length > 0
            && seriesMembers.every(work => prospectiveMemberPaths.has(work.file.path));
        });

        for (const seriesPage of seriesToLink) {
          if (toArray(seriesPage.collections).some(pointsToCurrent)) continue;
          const seriesFile = app.vault.getFileByPath(seriesPage.file.path);
          if (!seriesFile) continue;
          await app.fileManager.processFrontMatter(seriesFile, frontmatter => {
            const existing = Array.isArray(frontmatter.collections)
              ? [...frontmatter.collections]
              : (frontmatter.collections ? [frontmatter.collections] : []);
            if (!existing.some(pointsToCurrent)) existing.push(currentGroupLink);
            frontmatter.collections = existing;
          });
          linkedSeriesCount += 1;
        }
      }

      if (typeof Notice === "function") {
        const relationText = linkedSeriesCount ? `，并绑定 ${linkedSeriesCount} 个系列` : "";
        new Notice(`已将 ${added} 部作品添加到${kind}「${title}」${relationText}`);
      }
      closeModal();
    } catch (error) {
      console.error(`添加作品到${kind}失败`, error);
      if (typeof Notice === "function") new Notice("添加失败，请打开开发者控制台查看详情");
      confirm.disabled = false;
      confirm.setText("重新添加");
    }
  });

  renderCandidates();
  document.addEventListener("keydown", handleModalKeydown);
  window.setTimeout(() => search.focus(), 0);
};

addWorks.addEventListener("click", openAddWorksModal);

editOrder.addEventListener("click", () => {
  const enteringManageMode = !root.classList.contains("is-managing");
  root.classList.toggle("is-managing", enteringManageMode);
  editOrder.setText(enteringManageMode ? "完成管理" : "管理成员");
});

const timeline = content.createDiv({ cls: "media-collection-timeline" });

if (!members.length) {
  const empty = timeline.createDiv({ cls: "media-collection-empty" });
  empty.createEl("strong", { text: "还没有成员" });
  empty.createDiv({ text: isSeries ? "点击“添加作品”即可把作品加入当前系列。" : "点击“添加作品”即可把作品直接收录到当前合集。" });
}

members.forEach((member, index) => {
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

  const meta = copy.createDiv({ cls: "media-collection-member-meta" });
  const year = yearText(member.release_date);
  if (year) meta.createSpan({ text: year });
  if (typeof member.rating === "number" && member.rating > 0) meta.createSpan({ cls: "is-rating", text: `${member.rating} ★` });

  const open = copy.createEl("a", { cls: "media-collection-member-open internal-link", text: "打开作品" });
  open.setAttr("href", member.file.path);
  open.setAttr("data-href", member.file.path);

  const remove = copy.createEl("button", {
    cls: "media-collection-member-remove",
    text: `移出${kind}`,
    attr: { type: "button", "aria-label": `将${member.title || member.file.name}移出当前${kind}` }
  });
  remove.addEventListener("click", async () => {
    const workFile = app.vault.getFileByPath(member.file.path);
    if (!workFile) {
      if (typeof Notice === "function") new Notice("没有找到对应的作品文件");
      return;
    }

    remove.disabled = true;
    remove.setText("正在移出…");
    try {
      await app.fileManager.processFrontMatter(workFile, frontmatter => {
        if (isSeries) {
          if (pointsToCurrent(frontmatter.series)) frontmatter.series = "";
          return;
        }
        const existing = Array.isArray(frontmatter.collections)
          ? frontmatter.collections
          : (frontmatter.collections ? [frontmatter.collections] : []);
        frontmatter.collections = existing.filter(value => !pointsToCurrent(value));
      });

      if (!isSeries && member.series) {
        const memberSeries = allGroups.find(group =>
          group.collection_kind === "series" && pointsToPage(member.series, group)
        );
        const remainingPaths = new Set(
          members
            .filter(candidate => candidate.file.path !== member.file.path)
            .map(candidate => candidate.file.path)
        );
        const seriesMembers = memberSeries
          ? allWorks.filter(work => pointsToPage(work.series, memberSeries))
          : [];
        const seriesStillComplete = seriesMembers.length > 0
          && seriesMembers.every(work => remainingPaths.has(work.file.path));

        if (memberSeries && !seriesStillComplete && toArray(memberSeries.collections).some(pointsToCurrent)) {
          const seriesFile = app.vault.getFileByPath(memberSeries.file.path);
          if (seriesFile) {
            await app.fileManager.processFrontMatter(seriesFile, frontmatter => {
              const existing = Array.isArray(frontmatter.collections)
                ? frontmatter.collections
                : (frontmatter.collections ? [frontmatter.collections] : []);
              frontmatter.collections = existing.filter(value => !pointsToCurrent(value));
            });
          }
        }
      }

      item.remove();
      const remaining = timeline.querySelectorAll(".media-collection-member").length;
      memberCount.setText(`${remaining} 部作品`);
      if (typeof Notice === "function") new Notice(`已将「${member.title || member.file.name}」移出${kind}`);
    } catch (error) {
      console.error(`移出${kind}失败`, error);
      if (typeof Notice === "function") new Notice("移出失败，请打开开发者控制台查看详情");
      remove.disabled = false;
      remove.setText(`移出${kind}`);
    }
  });
});
