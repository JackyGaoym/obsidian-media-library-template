const page = dv.current();

if (!page || page.note_type !== "media") {
  return;
}

const typeLabels = {
  book: "图书",
  tv: "电视剧",
  movie: "电影",
  anime: "动漫",
  game: "游戏"
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

const dateText = value => {
  if (!value) return "";
  if (typeof value.toFormat === "function") return value.toFormat("yyyy-MM-dd");
  return String(value);
};

const resourceUrl = value => {
  const raw = value?.path ?? String(value || "");
  const linkPath = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  if (!linkPath) return "";
  const file = app.metadataCache.getFirstLinkpathDest(linkPath, page.file.path);
  return file ? app.vault.getResourcePath(file) : "";
};

const addFact = (facts, label, value) => {
  const text = plainText(value);
  if (text) facts.push({ label, value: text });
};

const cover = resourceUrl(page.cover);
const customBackdrop = resourceUrl(page.backdrop);
const backdrop = customBackdrop || cover;
const root = dv.container.createDiv({
  cls: `media-work-hero is-${page.media_type || "media"}${customBackdrop ? " has-custom-backdrop" : " uses-cover-backdrop"}`
});
if (backdrop) root.style.setProperty("--media-work-backdrop", `url("${backdrop.replace(/"/g, "\\\"")}")`);

const posterColumn = root.createDiv({ cls: "media-work-poster-column" });
const poster = posterColumn.createDiv({ cls: "media-work-poster" });
if (cover) {
  const image = poster.createEl("img");
  image.setAttr("src", cover);
  image.setAttr("alt", `${page.title || page.file.name}封面`);
} else {
  poster.createDiv({ cls: "media-work-poster-fallback", text: typeLabels[page.media_type] || "作品" });
}

const posterActions = posterColumn.createDiv({ cls: "media-work-poster-actions" });

if (page.source_url) {
  const source = posterActions.createEl("a", { cls: "media-work-source", text: page.source === "douban" ? "查看豆瓣条目" : "查看来源" });
  source.setAttr("href", String(page.source_url));
  source.setAttr("target", "_blank");
  source.setAttr("rel", "noopener");
}

const mountCoverControl = () => {
  const mountHost = posterActions.createDiv({ cls: "media-work-cover-mount" });
  try {
    const metaBind = app.plugins.getPlugin("obsidian-meta-bind-plugin");
    const declaration = 'INPUT[imageSuggester(optionQuery("媒体库/附件/封面"), title(选择封面)):cover]';
    const fieldType = metaBind?.api?.isInlineFieldDeclarationAndGetType(declaration);
    if (!metaBind?.api || !fieldType) throw new Error("Meta Bind API unavailable");

    const mountable = metaBind.api.createInlineFieldOfTypeFromString(fieldType, declaration, page.file.path);
    mountable.mount(mountHost);
    mountHost.metaBindMountable = mountable;

    const label = cover ? "更换封面" : "选择封面";
    const button = posterActions.createEl("button", {
      cls: "media-work-cover-trigger",
      text: label,
      attr: { type: "button", "aria-label": label, title: label }
    });

    button.addEventListener("click", () => {
      const imageField = mountable.inputField;
      if (typeof imageField?.openModal === "function") {
        imageField.openModal();
        return;
      }

      const hiddenTrigger = mountHost.querySelector(".mb-image-empty button, .mb-image-card button");
      if (hiddenTrigger) {
        hiddenTrigger.click();
        return;
      }

      console.error("封面选择器无法直接打开：当前 Meta Bind 版本缺少图片字段接口");
      if (typeof Notice === "function") new Notice("封面选择器暂时无法打开，请检查 Meta Bind 是否已启用");
    });
  } catch (error) {
    mountHost.remove();
    console.error("作品封面选择器加载失败", error);
  }
};

mountCoverControl();

const info = root.createDiv({ cls: "media-work-info" });
info.createEl("h1", { cls: "media-work-title", text: page.title || page.file.name });

if (page.original_title) {
  info.createDiv({ cls: "media-work-original-title", text: plainText(page.original_title) });
}

const facts = [];
addFact(facts, "发行", dateText(page.release_date));
addFact(facts, "分类", typeLabels[page.media_type]);

if (page.media_type === "movie") {
  addFact(facts, "时长", page.runtime_minutes);
} else if (page.media_type === "tv" || page.media_type === "anime") {
  addFact(facts, "集数", page.episode_count ? `${page.episode_count} 集` : "");
} else if (page.media_type === "book") {
  addFact(facts, "出版社", page.publisher);
  addFact(facts, "页数", page.page_count ? `${page.page_count} 页` : "");
} else if (page.media_type === "game") {
  addFact(facts, "平台", toArray(page.platforms).map(plainText).filter(Boolean).slice(0, 3).join(" / "));
}

const countries = toArray(page.country).map(plainText).filter(Boolean);
if (countries.length) addFact(facts, "地区", countries.slice(0, 2).join(" / "));

const factRow = info.createDiv({ cls: "media-work-facts" });
for (const fact of facts) {
  const item = factRow.createDiv({ cls: "media-work-fact" });
  item.createSpan({ cls: "media-work-fact-label", text: fact.label });
  item.createSpan({ cls: "media-work-fact-value", text: fact.value });
}

const genres = toArray(page.genres).map(plainText).filter(Boolean);
if (genres.length) {
  const genreRow = info.createDiv({ cls: "media-work-genres" });
  for (const genre of genres.slice(0, 8)) genreRow.createSpan({ text: genre });
}

const ratings = info.createDiv({ cls: "media-work-ratings" });
const personal = ratings.createDiv({ cls: "media-work-rating" });
personal.createDiv({ cls: "media-work-rating-label", text: "我的评分" });
const personalValue = personal.createDiv({ cls: "media-work-rating-value" });
const personalNumber = personalValue.createSpan({ text: typeof page.rating === "number" && page.rating > 0 ? String(page.rating) : "—" });
personalValue.createEl("small", { text: " / 5" });

const sourceRating = ratings.createDiv({ cls: "media-work-rating" });
sourceRating.createDiv({ cls: "media-work-rating-label", text: page.source === "douban" ? "豆瓣评分" : "来源评分" });
const sourceValue = sourceRating.createDiv({ cls: "media-work-rating-value" });
sourceValue.createSpan({ text: page.source_rating !== null && page.source_rating !== undefined && page.source_rating !== "" ? String(page.source_rating) : "—" });
if (page.source === "douban" && page.source_rating !== null && page.source_rating !== undefined && page.source_rating !== "") {
  sourceValue.createEl("small", { text: " / 10" });
}

const credits = [];
const authors = toArray(page.authors).map(plainText).filter(Boolean);
const directors = toArray(page.directors).map(plainText).filter(Boolean);
if (authors.length) credits.push(`作者：${authors.slice(0, 3).join(" / ")}`);
if (directors.length) credits.push(`导演：${directors.slice(0, 3).join(" / ")}`);
if (page.developer) credits.push(`开发：${plainText(page.developer)}`);
if (credits.length) info.createDiv({ cls: "media-work-credits", text: credits.join("　") });

const mediaFile = app.vault.getAbstractFileByPath(page.file.path);

const writeFields = async values => {
  if (!mediaFile) return;
  await app.fileManager.processFrontMatter(mediaFile, frontmatter => {
    for (const [field, value] of Object.entries(values)) frontmatter[field] = value;
  });
};

const writeField = async (field, value) => writeFields({ [field]: value });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const numberFrom = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
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

const showNotice = message => {
  try {
    const NoticeClass = typeof Notice === "function"
      ? Notice
      : (typeof require === "function" ? require("obsidian").Notice : null);
    if (NoticeClass) new NoticeClass(message);
  } catch (error) {
    console.error(message, error);
  }
};

const mountRating = host => {
  host.empty();
  host.addClass("is-ready");

  let savedRating = typeof page.rating === "number" ? clamp(Math.round(page.rating * 2) / 2, 0, 5) : 0;
  let previewRating = savedRating;
  let pointerActive = false;

  const stars = host.createDiv({ cls: "media-rating-stars" });
  const starElements = [];

  for (let index = 0; index < 5; index += 1) {
    const star = stars.createSpan({ cls: "media-rating-star" });
    star.createSpan({ cls: "media-rating-star-base", text: "★" });
    const fill = star.createSpan({ cls: "media-rating-star-fill", text: "★" });
    starElements.push(fill);
  }

  const clearButton = host.createEl("button", {
    cls: "media-rating-clear clickable-icon",
    attr: { type: "button", "aria-label": "清除评分" }
  });
  clearButton.setText("×");

  stars.setAttr("role", "slider");
  stars.setAttr("tabindex", "0");
  stars.setAttr("aria-label", "我的评分，支持半星");
  stars.setAttr("aria-valuemin", "0");
  stars.setAttr("aria-valuemax", "5");
  stars.setAttr("aria-valuestep", "0.5");

  const render = (value, isPreview = false) => {
    previewRating = value;
    starElements.forEach((fill, index) => {
      const amount = clamp(value - index, 0, 1);
      fill.style.width = `${amount * 100}%`;
    });
    host.classList.toggle("is-previewing", isPreview && value !== savedRating);
    stars.setAttr("aria-valuenow", String(value));
    stars.setAttr("aria-valuetext", value > 0 ? `${value} 星` : "未评分");
    clearButton.classList.toggle("is-visible", savedRating > 0);
  };

  const ratingFromPointer = event => {
    const bounds = stars.getBoundingClientRect();
    const position = clamp(event.clientX - bounds.left, 0, bounds.width);
    return clamp(Math.ceil((position / bounds.width) * 10) / 2, 0.5, 5);
  };

  const commit = async value => {
    savedRating = clamp(Math.round(value * 2) / 2, 0, 5);
    render(savedRating);
    personalNumber.setText(savedRating > 0 ? String(savedRating) : "—");
    await writeField("rating", savedRating > 0 ? savedRating : null);
  };

  stars.addEventListener("pointermove", event => {
    render(ratingFromPointer(event), true);
  });

  stars.addEventListener("pointerleave", () => {
    if (!pointerActive) render(savedRating);
  });

  stars.addEventListener("pointerdown", event => {
    pointerActive = true;
    stars.setPointerCapture?.(event.pointerId);
    render(ratingFromPointer(event), true);
    event.preventDefault();
  });

  stars.addEventListener("pointerup", event => {
    if (!pointerActive) return;
    pointerActive = false;
    stars.releasePointerCapture?.(event.pointerId);
    void commit(ratingFromPointer(event));
  });

  stars.addEventListener("keydown", event => {
    let next = savedRating;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = clamp(savedRating + 0.5, 0.5, 5);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = clamp(savedRating - 0.5, 0, 5);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 5;
    else return;
    event.preventDefault();
    void commit(next);
  });

  clearButton.addEventListener("click", event => {
    event.stopPropagation();
    void commit(0);
  });

  render(savedRating);
};

const mountProgress = host => {
  host.empty();
  host.addClass("is-ready");

  const configs = {
    book: { field: "current_page", totalField: "page_count", unit: "页", step: 1 },
    tv: { field: "current_episode", totalField: "episode_count", unit: "集", step: 1 },
    movie: { field: "current_minutes", totalField: "runtime_minutes", unit: "分", step: 10 },
    anime: { field: "current_episode", totalField: "episode_count", unit: "集", step: 1 },
    game: { field: "progress_percent", totalField: null, unit: "%", step: 5, fixedTotal: 100 }
  };
  const config = configs[page.media_type];
  if (!config) {
    host.remove();
    return;
  }

  const total = config.fixedTotal ?? Math.max(0, Math.round(numberFrom(page[config.totalField])));
  const hasTotal = total > 0;
  let savedProgress = Math.max(0, Math.round(numberFrom(page[config.field])));
  if (hasTotal) savedProgress = Math.min(savedProgress, total);
  let currentStatus = page.status;
  let statusControl = null;

  const label = host.previousElementSibling;
  if (label?.tagName === "STRONG") {
    label.addClass("media-progress-label");
    const row = document.createElement("span");
    row.className = "media-progress-row";
    label.parentNode.insertBefore(row, label);
    row.append(label, host);
  }

  const decrement = host.createEl("button", {
    cls: "media-progress-step clickable-icon",
    attr: { type: "button", "aria-label": `减少 ${config.step} ${config.unit}` }
  });
  setAppIcon(decrement, "minus", "−");

  const input = host.createEl("input", {
    cls: "media-progress-number",
    attr: {
      type: "number",
      min: "0",
      step: String(config.step),
      value: String(savedProgress),
      inputmode: "numeric",
      "aria-label": "当前进度"
    }
  });
  if (hasTotal) input.setAttr("max", String(total));

  const suffix = host.createSpan({
    cls: "media-progress-suffix",
    text: config.unit === "%" ? "%" : `/ ${hasTotal ? total : "?"} ${config.unit}`
  });

  const increment = host.createEl("button", {
    cls: "media-progress-step clickable-icon",
    attr: { type: "button", "aria-label": `增加 ${config.step} ${config.unit}` }
  });
  setAppIcon(increment, "plus", "+");

  const track = host.createSpan({ cls: `media-progress-track${hasTotal ? "" : " is-unknown"}` });
  const fill = track.createSpan({ cls: "media-progress-fill" });
  const output = host.createEl("output", { cls: "media-progress-output" });
  const hint = host.createSpan({
    cls: "media-progress-hint",
    text: hasTotal
      ? "状态设为已完成会补满进度；从满值减少会恢复为进行中"
      : `缺少总${config.unit === "页" ? "页数" : config.unit === "集" ? "集数" : "时长"}，暂时无法自动补满`
  });

  const render = value => {
    const current = hasTotal
      ? clamp(Math.round(Number(value) || 0), 0, total)
      : Math.max(0, Math.round(Number(value) || 0));
    const percent = hasTotal ? clamp(current / total * 100, 0, 100) : 0;
    input.value = String(current);
    fill.style.width = `${percent}%`;
    output.setText(hasTotal ? `${Math.round(percent)}%` : "—");
    decrement.disabled = current <= 0;
    increment.disabled = hasTotal && current >= total;
    return current;
  };

  const commit = async value => {
    const next = render(value);
    if (next === savedProgress) return;
    savedProgress = next;
    const updates = { [config.field]: savedProgress };
    const shouldResume = hasTotal && savedProgress < total && currentStatus === "已完成";
    if (shouldResume) {
      currentStatus = "进行中";
      updates.status = currentStatus;
      if (statusControl) statusControl.value = currentStatus;
    }
    await writeFields(updates);
    if (shouldResume) showNotice("进度未满，状态已恢复为进行中");
  };

  decrement.addEventListener("click", () => void commit(savedProgress - config.step));
  increment.addEventListener("click", () => void commit(savedProgress + config.step));
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("change", () => void commit(input.value));
  input.addEventListener("blur", () => void commit(input.value));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });

  const attachCompletionSync = () => {
    const callout = host.closest('.callout[data-callout="media-control"]');
    const statusSelect = Array.from(callout?.querySelectorAll("select") || []).find(select =>
      Array.from(select.options || []).some(option => option.value === "已完成"));
    if (!statusSelect || statusSelect.dataset.mediaProgressSync === "true") return false;
    statusControl = statusSelect;
    currentStatus = statusSelect.value || currentStatus;
    statusSelect.dataset.mediaProgressSync = "true";
    statusSelect.addEventListener("change", () => {
      currentStatus = statusSelect.value;
      if (statusSelect.value !== "已完成") return;
      if (!hasTotal) {
        showNotice(`缺少总${config.unit === "页" ? "页数" : config.unit === "集" ? "集数" : "时长"}，无法自动补满进度`);
        return;
      }
      window.setTimeout(() => void commit(total), 80);
    });
    return true;
  };

  render(savedProgress);
  if (!attachCompletionSync()) window.setTimeout(attachCompletionSync, 180);
  if (page.status === "已完成" && hasTotal && savedProgress < total) void commit(total);
};

const mountInteractiveControls = () => {
  const note = dv.container.closest(".media-library-note");
  if (!note) return;
  note.querySelectorAll(".media-rating-control:not(.is-ready)").forEach(mountRating);
  note.querySelectorAll(".media-progress-control:not(.is-ready)").forEach(mountProgress);
};

window.requestAnimationFrame(() => window.requestAnimationFrame(mountInteractiveControls));
window.setTimeout(mountInteractiveControls, 120);
