await dv.view("媒体库/视图/主题");

const page = dv.current();

if (!page || page.note_type !== "media") {
  return;
}

const typeController = window.__mediaLibraryTypeControllers?.get(app.vault.getName());
const typeDefinitions = typeController?.getTypes() || [];
const typeLabels = Object.fromEntries(typeDefinitions.map(type => [type.id, type.label]));
const workFormat = typeController?.progressType(page) || page.media_type;

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

const resourcePath = value => {
  const raw = value?.path ?? String(value || "");
  return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
};

const parseBackdropPosition = value => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "center") return { x: 50, y: 50 };
  const percentages = [...raw.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map(match => Number(match[1]));
  if (percentages.length < 2) return { x: 50, y: 50 };
  return {
    x: Math.min(100, Math.max(0, percentages[0])),
    y: Math.min(100, Math.max(0, percentages[1]))
  };
};

const addFact = (facts, label, value) => {
  const text = plainText(value);
  if (text) facts.push({ label, value: text });
};

const cover = resourceUrl(page.cover);
const customBackdrop = resourceUrl(page.backdrop);
const backdrop = customBackdrop || cover;
let liveBackdropPath = resourcePath(page.backdrop);
let liveBackdropPosition = parseBackdropPosition(page.backdrop_position);
const root = dv.container.createDiv({
  cls: `media-work-hero is-${page.media_type || "media"}${customBackdrop ? " has-custom-backdrop" : " uses-cover-backdrop"}`
});
if (backdrop) root.style.setProperty("--media-work-backdrop", `url("${backdrop.replace(/"/g, "\\\"")}")`);
root.style.setProperty("--media-work-backdrop-position", `${liveBackdropPosition.x}% ${liveBackdropPosition.y}%`);

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

const artworkActions = posterActions.createDiv({ cls: "media-work-artwork-actions" });

const localizeCoverPicker = () => {
  const picker = document.querySelector(".mb-image-suggester-modal");
  if (!picker) return false;

  const title = picker.querySelector(".modal-title, .modal-header");
  if (title && title.textContent !== "选择封面") title.textContent = "选择封面";

  const search = picker.querySelector('.mb-image-modal-header input, input[type="search"]');
  if (search) {
    search.setAttribute("placeholder", "搜索封面图片…");
    search.setAttribute("aria-label", "搜索封面图片");
  }

  const closeButton = picker.querySelector(".modal-close-button, .modal-header-button") || title?.previousElementSibling;
  if (closeButton) {
    closeButton.classList.add("media-library-modal-close");
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.removeAttribute("title");
  }

  for (const card of picker.querySelectorAll(".mb-image-card")) {
    const image = card.querySelector(".mb-image-card-image");
    const label = card.querySelector(".mb-image-card-footer");
    const sourcePath = image?.getAttribute("alt")?.trim() || label?.textContent.trim() || "";
    const fileName = sourcePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || sourcePath;
    if (label && label.textContent !== fileName) label.textContent = fileName;
    if (fileName && card.getAttribute("aria-label") !== `选择 ${fileName}`) {
      card.setAttribute("aria-label", `选择 ${fileName}`);
    }
  }

  for (const button of picker.querySelectorAll("button")) {
    const label = button.textContent.trim();
    if (label === "Select none") {
      button.textContent = "不使用封面";
      button.setAttribute("aria-label", "不使用封面");
    } else if (label === "Cancel") {
      button.textContent = "取消";
      button.setAttribute("aria-label", "取消");
    }
  }

  if (!picker.mediaLibraryLocalizationObserver) {
    const observer = new MutationObserver(() => localizeCoverPicker());
    observer.observe(picker, { childList: true, subtree: true });
    picker.mediaLibraryLocalizationObserver = observer;
  }
  return true;
};

const scheduleCoverPickerLocalization = () => {
  requestAnimationFrame(() => localizeCoverPicker());
  window.setTimeout(() => localizeCoverPicker(), 80);
};

const mountCoverControl = () => {
  const mountHost = posterActions.createDiv({ cls: "media-work-cover-mount" });
  try {
    const metaBind = app.plugins.getPlugin("obsidian-meta-bind-plugin");
    const declaration = 'INPUT[imageSuggester(optionQuery("媒体库/作品/封面"), title(选择封面)):cover]';
    const fieldType = metaBind?.api?.isInlineFieldDeclarationAndGetType(declaration);
    if (!metaBind?.api || !fieldType) throw new Error("Meta Bind API unavailable");

    const mountable = metaBind.api.createInlineFieldOfTypeFromString(fieldType, declaration, page.file.path);
    mountable.mount(mountHost);
    mountHost.metaBindMountable = mountable;

    const label = cover ? "更换封面" : "选择封面";
    const button = artworkActions.createEl("button", {
      cls: "media-work-cover-trigger",
      text: label,
      attr: { type: "button", "aria-label": label, title: label }
    });

    button.addEventListener("click", () => {
      const imageField = mountable.inputField;
      if (typeof imageField?.openModal === "function") {
        imageField.openModal();
        scheduleCoverPickerLocalization();
        return;
      }

      const hiddenTrigger = mountHost.querySelector(".mb-image-empty button, .mb-image-card button");
      if (hiddenTrigger) {
        hiddenTrigger.click();
        scheduleCoverPickerLocalization();
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
const heading = info.createDiv({ cls: "media-work-heading" });
heading.createEl("h1", { cls: "media-work-title", text: page.title || page.file.name });
const editMetadataButton = heading.createEl("button", {
  cls: "media-work-edit-metadata",
  attr: { type: "button", "aria-label": "编辑作品资料", title: "编辑作品资料" }
});
const editMetadataIcon = editMetadataButton.createSpan({ cls: "media-work-edit-metadata-icon" });

if (page.original_title) {
  info.createDiv({ cls: "media-work-original-title", text: plainText(page.original_title) });
}

const facts = [];
addFact(facts, "发行", dateText(page.release_date));
addFact(facts, "分类", typeLabels[page.media_type]);

if (workFormat === "movie") {
  addFact(facts, "时长", page.runtime_minutes);
} else if (workFormat === "series") {
  addFact(facts, "集数", page.episode_count ? `${page.episode_count} 集` : "");
} else if (workFormat === "book") {
  addFact(facts, "出版社", page.publisher);
  addFact(facts, "页数", page.page_count ? `${page.page_count} 页` : "");
} else if (workFormat === "game") {
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
let frontmatterWriteQueue = Promise.resolve();
let liveFinishedAt = dateText(page.finished_at);
let liveExperienceIndex = Math.max(1, Math.round(Number(page.experience_index)) || 1);

const writeFrontmatter = updater => {
  if (!mediaFile) return Promise.reject(new Error(`没有找到作品文件：${page.file.path}`));
  const task = frontmatterWriteQueue
    .catch(() => undefined)
    .then(() => app.fileManager.processFrontMatter(mediaFile, updater));
  frontmatterWriteQueue = task;
  return task;
};

const writeFields = values => writeFrontmatter(frontmatter => {
  for (const [field, value] of Object.entries(values)) frontmatter[field] = value;
});

const writeField = async (field, value) => writeFields({ [field]: value });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const numberFrom = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const progressConfigs = {
  book: { field: "current_page", totalField: "page_count", unit: "页", historyUnit: "page", step: 1 },
  series: { field: "current_episode", totalField: "episode_count", unit: "集", historyUnit: "episode", step: 1 },
  movie: { field: "current_minutes", totalField: "runtime_minutes", unit: "分", historyUnit: "minute", step: 10 },
  game: { field: "progress_percent", totalField: null, unit: "%", historyUnit: "percent", step: 5, fixedTotal: 100 }
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

setAppIcon(editMetadataIcon, "pencil", "✎");

const metadataFieldsFor = (mediaType, mediaFormat) => {
  const typeDefinition = typeController?.getType(mediaType);
  const editableTypeDefinitions = typeDefinitions.filter(type =>
    typeController?.isEnabled(type.id) || type.id === page.media_type || type.id === mediaType);
  const fields = [
    { field: "title", label: "作品名", group: "基本资料", required: true },
    {
      field: "media_type",
      label: "作品类型",
      group: "基本资料",
      kind: "select",
      options: editableTypeDefinitions.map(type => [type.id, type.label])
    },
    ...(typeDefinition?.flexibleFormat ? [{
      field: "media_format",
      label: "作品形式",
      group: "基本资料",
      kind: "select",
      options: [["movie", "单部（按时长）"], ["series", "剧集（按集数）"]]
    }] : []),
    { field: "original_title", label: "原名", group: "基本资料" },
    { field: "release_date", label: "发行日期", group: "基本资料", placeholder: "YYYY-MM-DD，也可只填年份" },
    { field: "genres", label: "类型标签", group: "基本资料", kind: "list", placeholder: "多项用逗号分隔" },
    { field: "source_rating", label: page.source === "douban" ? "豆瓣评分" : "来源评分", group: "来源资料", kind: "number", min: 0, max: 10, step: 0.1 },
    { field: "source_url", label: "来源链接", group: "来源资料", kind: "url", wide: true }
  ];

  const detailIndex = fields.findIndex(field => field.group === "来源资料");
  if (mediaFormat === "movie") {
    fields.splice(detailIndex, 0,
      { field: "runtime_minutes", label: "片长（分钟）", group: "基本资料", kind: "number", min: 0, step: 1 },
      { field: "country", label: "地区", group: "基本资料" },
      { field: "language", label: "语言", group: "基本资料" },
      { field: "directors", label: "导演", group: "主创信息", kind: "list" },
      { field: "screenwriters", label: "编剧", group: "主创信息", kind: "list" },
      { field: "cast", label: "演员", group: "主创信息", kind: "list", wide: true },
      { field: "imdb_id", label: "IMDb", group: "来源资料" }
    );
  } else if (mediaFormat === "series") {
    fields.splice(detailIndex, 0,
      { field: "episode_count", label: "总集数", group: "基本资料", kind: "number", min: 0, step: 1 },
      { field: "season_count", label: "总季数", group: "基本资料", kind: "number", min: 0, step: 1 },
      { field: "country", label: "地区", group: "基本资料" },
      { field: "language", label: "语言", group: "基本资料" },
      { field: "directors", label: "导演", group: "主创信息", kind: "list" },
      { field: "screenwriters", label: "编剧", group: "主创信息", kind: "list" },
      { field: "cast", label: "演员", group: "主创信息", kind: "list", wide: true },
      { field: "imdb_id", label: "IMDb", group: "来源资料" }
    );
  } else if (mediaFormat === "book") {
    fields.splice(detailIndex, 0,
      { field: "authors", label: "作者", group: "出版信息", kind: "list" },
      { field: "translators", label: "译者", group: "出版信息", kind: "list" },
      { field: "publisher", label: "出版社", group: "出版信息" },
      { field: "page_count", label: "总页数", group: "出版信息", kind: "number", min: 0, step: 1 },
      { field: "isbn", label: "ISBN", group: "来源资料" },
      { field: "source_series", label: "豆瓣丛书", group: "来源资料" }
    );
  } else if (mediaFormat === "game") {
    fields.splice(detailIndex, 0,
      { field: "platforms", label: "平台", group: "游戏资料", kind: "list" },
      { field: "developer", label: "开发商", group: "游戏资料" },
      { field: "aliases", label: "别名", group: "游戏资料", kind: "list", wide: true }
    );
  }

  return fields;
};

const compactText = value => String(value ?? "").replace(/\s+/g, " ").trim();
const splitMetadataList = value => [...new Set(String(value ?? "")
  .split(/[,\n，、]+/)
  .map(item => compactText(item))
  .filter(Boolean))];
const isBlankMetadata = value => value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);
const numericMetadata = value => {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const metadataValueFromPage = definition => {
  if (definition.field === "media_format") return workFormat;
  const value = page[definition.field];
  if (definition.kind === "list") return toArray(value).map(plainText).filter(Boolean);
  if (definition.kind === "number") return isBlankMetadata(value) ? null : numericMetadata(value);
  if (definition.field === "release_date") return dateText(value);
  return plainText(value);
};

const mountMetadataEditor = () => {
  const initialDefinitions = metadataFieldsFor(page.media_type, workFormat);

  editMetadataButton.addEventListener("click", () => {
    let ModalClass;
    try {
      ModalClass = typeof require === "function" ? require("obsidian").Modal : null;
    } catch (error) {
      ModalClass = null;
    }
    if (!ModalClass) {
      ModalClass = class {
        open() {
          this.overlayEl = document.body.createDiv({ cls: "media-metadata-overlay modal-container" });
          this.modalEl = this.overlayEl.createDiv({
            cls: "media-metadata-editor-modal modal",
            attr: { role: "dialog", "aria-modal": "true", "aria-label": "编辑作品资料" }
          });
          const closeButton = this.modalEl.createEl("button", {
            cls: "modal-close-button",
            attr: { type: "button", "aria-label": "关闭" }
          });
          setAppIcon(closeButton, "x", "×");
          const modalBody = this.modalEl.createDiv({ cls: "modal-content" });
          this.titleEl = modalBody.createEl("h1", { cls: "modal-title" });
          this.contentEl = modalBody.createDiv();
          this.handleKeydown = event => {
            if (event.key === "Escape") this.close();
          };
          document.addEventListener("keydown", this.handleKeydown);
          closeButton.addEventListener("click", () => this.close());
          this.overlayEl.addEventListener("click", event => {
            if (event.target === this.overlayEl) this.close();
          });
          this.onOpen();
        }

        close() {
          document.removeEventListener("keydown", this.handleKeydown);
          this.onClose();
          this.overlayEl?.remove();
        }
      };
    }

    class MetadataEditorModal extends ModalClass {
      constructor() {
        super(app);
        this.values = Object.fromEntries(initialDefinitions.map(definition => [definition.field, metadataValueFromPage(definition)]));
        this.values.media_type = page.media_type;
        this.values.media_format = workFormat;
        this.definitions = initialDefinitions;
        this.definitionMap = new Map(initialDefinitions.map(definition => [definition.field, definition]));
        this.inputs = new Map();
        this.saving = false;
      }

      onOpen() {
        this.modalEl.addClass("media-metadata-editor-modal");
        this.titleEl.setText("编辑作品资料");
        this.render();
      }

      readInputs() {
        for (const definition of this.definitions) {
          const input = this.inputs.get(definition.field);
          if (!input) continue;
          if (definition.kind === "list") this.values[definition.field] = splitMetadataList(input.value);
          else if (definition.kind === "number") this.values[definition.field] = input.value === "" ? null : Number(input.value);
          else this.values[definition.field] = input.value.trim();
        }
      }

      valueForInput(definition) {
        const value = this.values[definition.field];
        return definition.kind === "list" ? toArray(value).join("，") : (value ?? "");
      }

      renderField(grid, definition) {
        const row = grid.createDiv({
          cls: `media-metadata-field${definition.wide ? " is-wide" : ""}`
        });
        const label = row.createEl("label", { text: definition.label });
        let input;
        if (definition.kind === "select") {
          input = row.createEl("select");
          for (const [value, text] of definition.options || []) {
            input.createEl("option", { text, attr: { value } });
          }
        } else if (definition.kind === "list" && definition.wide) {
          input = row.createEl("textarea", { attr: { rows: "2" } });
        } else {
          input = row.createEl("input", {
            attr: {
              type: definition.kind === "number" ? "number" : (definition.kind === "url" ? "url" : "text")
            }
          });
        }
        input.setAttr("aria-label", definition.label);
        if (definition.placeholder) input.setAttr("placeholder", definition.placeholder);
        if (definition.required) input.setAttr("required", "true");
        if (definition.kind === "number") {
          if (definition.min !== undefined) input.setAttr("min", String(definition.min));
          if (definition.max !== undefined) input.setAttr("max", String(definition.max));
          input.setAttr("step", String(definition.step ?? 1));
        }
        input.value = this.valueForInput(definition);
        const inputId = `${page.file.path}-${definition.field}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        label.setAttr("for", inputId);
        input.id = inputId;
        this.inputs.set(definition.field, input);
        if (["media_type", "media_format"].includes(definition.field)) {
          input.addEventListener("change", () => {
            this.readInputs();
            if (definition.field === "media_type") {
              const selectedType = typeController?.getType(this.values.media_type);
              this.values.media_format = selectedType?.format || workFormat;
            }
            this.render();
          });
        }

      }

      render() {
        const selectedType = typeController?.getType(this.values.media_type) || typeController?.getType(page.media_type);
        const selectedFormat = selectedType?.flexibleFormat
          ? (["movie", "series"].includes(this.values.media_format) ? this.values.media_format : selectedType.format)
          : (selectedType?.format || workFormat);
        this.values.media_format = selectedFormat;
        this.definitions = metadataFieldsFor(selectedType?.id || page.media_type, selectedFormat);
        for (const definition of this.definitions) {
          if (!(definition.field in this.values)) this.values[definition.field] = metadataValueFromPage(definition);
        }
        this.definitionMap = new Map(this.definitions.map(definition => [definition.field, definition]));
        this.contentEl.empty();
        this.inputs.clear();
        const shell = this.contentEl.createDiv({ cls: "media-metadata-editor" });
        const toolbar = shell.createDiv({ cls: "media-metadata-toolbar" });
        toolbar.createDiv({
          cls: "media-metadata-hint",
          text: "修改作品本身的资料；个人评分、状态和进度仍在作品页管理。"
        });

        const groups = [...new Set(this.definitions.map(definition => definition.group))];
        for (const groupName of groups) {
          const section = shell.createEl("section", { cls: "media-metadata-section" });
          section.createEl("h2", { text: groupName });
          const grid = section.createDiv({ cls: "media-metadata-grid" });
          for (const definition of this.definitions.filter(item => item.group === groupName)) {
            this.renderField(grid, definition);
          }
        }

        const footer = shell.createDiv({ cls: "media-metadata-footer" });
        footer.createEl("button", { text: "取消", attr: { type: "button" } })
          .addEventListener("click", () => this.close());
        const saveButton = footer.createEl("button", {
          cls: "mod-cta",
          text: this.saving ? "正在保存…" : "保存",
          attr: { type: "button" }
        });
        saveButton.disabled = this.saving;
        saveButton.addEventListener("click", () => void this.save());
      }

      validate(values) {
        if (!String(values.title || "").trim()) return "作品名不能为空";
        if (values.release_date && !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(values.release_date)) {
          return "发行日期请使用 YYYY、YYYY-MM 或 YYYY-MM-DD";
        }
        if (values.source_rating !== null && (!Number.isFinite(values.source_rating) || values.source_rating < 0 || values.source_rating > 10)) {
          return `${this.definitionMap.get("source_rating")?.label || "来源评分"}需要在 0–10 之间`;
        }
        for (const field of ["runtime_minutes", "episode_count", "season_count", "page_count"]) {
          if (!(field in values) || values[field] === null) continue;
          if (!Number.isFinite(values[field]) || values[field] < 0) return `${this.definitionMap.get(field)?.label || field} 需要填写非负数`;
        }
        if (values.source_url) {
          try {
            const url = new URL(values.source_url);
            if (!/^https?:$/.test(url.protocol)) return "来源链接需要使用 http 或 https";
          } catch (error) {
            return "来源链接格式不正确";
          }
        }
        return "";
      }

      async save() {
        if (this.saving) return;
        this.readInputs();
        const message = this.validate(this.values);
        if (message) {
          showNotice(message);
          return;
        }
        this.saving = true;
        this.render();
        try {
          await writeFrontmatter(frontmatter => {
            for (const definition of this.definitions) {
              const value = this.values[definition.field];
              if (definition.kind === "list") frontmatter[definition.field] = toArray(value).filter(Boolean);
              else if (definition.kind === "number") frontmatter[definition.field] = value === null ? null : value;
              else frontmatter[definition.field] = value ?? "";
            }
            const selectedType = typeController?.getType(this.values.media_type);
            if (selectedType) {
              frontmatter.media_type = selectedType.id;
              frontmatter.media_format = selectedType.flexibleFormat
                ? (this.values.media_format || workFormat || selectedType.format)
                : selectedType.format;
            }
          });
          showNotice("作品资料已保存");
          this.close();
        } catch (error) {
          this.saving = false;
          showNotice("保存失败，现有资料未被覆盖");
          this.render();
        }
      }

      onClose() {
        this.contentEl.empty();
      }
    }

    new MetadataEditorModal().open();
  });
};

mountMetadataEditor();

const mountBackdropControl = () => {
  const button = artworkActions.createEl("button", {
    cls: "media-work-backdrop-trigger",
    attr: { type: "button" }
  });

  const syncButton = () => {
    const label = liveBackdropPath ? "调整横幅" : "设置横幅";
    button.setText(label);
    button.setAttr("aria-label", label);
  };

  const applyBackdropVisual = () => {
    const selectedUrl = resourceUrl(liveBackdropPath);
    const visualUrl = selectedUrl || cover;
    root.removeClass(selectedUrl ? "uses-cover-backdrop" : "has-custom-backdrop");
    root.addClass(selectedUrl ? "has-custom-backdrop" : "uses-cover-backdrop");
    if (visualUrl) {
      root.style.setProperty("--media-work-backdrop", `url("${visualUrl.replace(/"/g, "\\\"")}")`);
    } else {
      root.style.removeProperty("--media-work-backdrop");
    }
    root.style.setProperty(
      "--media-work-backdrop-position",
      `${liveBackdropPosition.x}% ${liveBackdropPosition.y}%`
    );
    syncButton();
  };

  const saveBackdrop = async (file, position) => {
    try {
      const normalized = {
        x: Math.round(clamp(position.x, 0, 100)),
        y: Math.round(clamp(position.y, 0, 100))
      };
      await writeFrontmatter(frontmatter => {
        frontmatter.backdrop = file.path;
        frontmatter.backdrop_position = `${normalized.x}% ${normalized.y}%`;
      });
      liveBackdropPath = file.path;
      liveBackdropPosition = normalized;
      applyBackdropVisual();
      showNotice("横幅已保存");
      return true;
    } catch (error) {
      console.error("保存横幅失败", error);
      showNotice("横幅保存失败，请稍后重试");
      return false;
    }
  };

  const removeBackdrop = async () => {
    try {
      await writeFrontmatter(frontmatter => {
        frontmatter.backdrop = "";
        delete frontmatter.backdrop_position;
      });
      liveBackdropPath = "";
      liveBackdropPosition = { x: 50, y: 50 };
      applyBackdropVisual();
      showNotice("已移除横幅，恢复使用封面背景");
      return true;
    } catch (error) {
      console.error("移除横幅失败", error);
      showNotice("移除横幅失败，请稍后重试");
      return false;
    }
  };

  const openEditor = () => {
    let ModalClass;
    try {
      ModalClass = typeof require === "function" ? require("obsidian").Modal : null;
    } catch (error) {
      ModalClass = null;
    }
    if (!ModalClass) {
      ModalClass = class {
        open() {
          this.overlayEl = document.body.createDiv({ cls: "media-backdrop-overlay modal-container" });
          this.modalEl = this.overlayEl.createDiv({
            cls: "media-backdrop-editor-modal modal",
            attr: { role: "dialog", "aria-modal": "true", "aria-label": "横幅编辑器" }
          });
          const closeButton = this.modalEl.createEl("button", {
            cls: "modal-close-button",
            attr: { type: "button", "aria-label": "关闭" }
          });
          setAppIcon(closeButton, "x", "×");
          const modalBody = this.modalEl.createDiv({ cls: "modal-content" });
          this.titleEl = modalBody.createEl("h1", { cls: "modal-title" });
          this.contentEl = modalBody.createDiv({ cls: "media-backdrop-modal-content" });
          this.handleKeydown = event => {
            if (event.key === "Escape") this.close();
          };
          document.addEventListener("keydown", this.handleKeydown);
          closeButton.addEventListener("click", () => this.close());
          this.overlayEl.addEventListener("click", event => {
            if (event.target === this.overlayEl) this.close();
          });
          this.onOpen();
        }

        close() {
          document.removeEventListener("keydown", this.handleKeydown);
          this.onClose();
          this.overlayEl?.remove();
        }
      };
    }

    const imagePattern = /\.(?:avif|gif|jpe?g|png|webp)$/i;
    const files = app.vault.getFiles()
      .filter(file => file.path.startsWith("媒体库/作品/横幅/") && imagePattern.test(file.name))
      .sort((left, right) => left.basename.localeCompare(right.basename, "zh-CN"));
    const currentFile = liveBackdropPath
      ? app.vault.getAbstractFileByPath(liveBackdropPath)
      : null;
    const heroRect = root.getBoundingClientRect();
    const previewRatio = clamp(heroRect.width / Math.max(heroRect.height, 1), 1.7, 3.2);

    class BackdropEditorModal extends ModalClass {
      constructor() {
        super(app);
        this.pendingFile = currentFile && imagePattern.test(currentFile.name) ? currentFile : null;
        this.position = { ...liveBackdropPosition };
      }

      onOpen() {
        this.modalEl.addClass("media-backdrop-editor-modal");
        if (this.pendingFile) this.renderAdjustment();
        else this.renderPicker();
      }

      renderPicker() {
        this.titleEl.setText("选择横幅");
        this.contentEl.empty();
        const shell = this.contentEl.createDiv({ cls: "media-backdrop-picker" });
        shell.createDiv({
          cls: "media-backdrop-editor-hint",
          text: "选择图片后，可以继续拖动调整显示区域。"
        });

        if (!files.length) {
          shell.createDiv({
            cls: "media-backdrop-picker-empty",
            text: "请先将图片放入「媒体库/作品/横幅」文件夹。"
          });
        } else {
          let visibleFiles = files;
          const search = shell.createEl("input", {
            cls: "media-backdrop-picker-search",
            attr: { type: "search", placeholder: "搜索横幅图片…", "aria-label": "搜索横幅图片" }
          });
          search.addEventListener("input", () => {
            const query = search.value.trim().toLocaleLowerCase("zh-CN");
            visibleFiles = query
              ? files.filter(file => `${file.basename} ${file.path}`.toLocaleLowerCase("zh-CN").includes(query))
              : files;
            renderCards();
          });
          requestAnimationFrame(() => search.focus());

          const grid = shell.createDiv({ cls: "media-backdrop-picker-grid" });
          const renderCards = () => {
            grid.empty();
            if (!visibleFiles.length) {
              grid.createDiv({ cls: "media-backdrop-picker-empty", text: "没有找到匹配的横幅图片。" });
              return;
            }
            for (const file of visibleFiles) {
              const card = grid.createEl("button", {
                cls: `media-backdrop-picker-card${this.pendingFile?.path === file.path ? " is-selected" : ""}`,
                attr: { type: "button", "aria-label": `选择 ${file.basename}` }
              });
              card.createEl("img", {
                attr: { src: app.vault.getResourcePath(file), alt: "", loading: "lazy" }
              });
              card.createSpan({ text: file.basename });
              card.addEventListener("click", () => {
                const keepsPosition = liveBackdropPath === file.path;
                this.pendingFile = file;
                this.position = keepsPosition ? { ...liveBackdropPosition } : { x: 50, y: 50 };
                this.renderAdjustment();
              });
            }
          };
          renderCards();
        }

        const footer = shell.createDiv({ cls: "media-backdrop-editor-footer" });
        footer.createEl("button", { text: "取消", attr: { type: "button" } })
          .addEventListener("click", () => this.close());
      }

      renderAdjustment() {
        if (!this.pendingFile) {
          this.renderPicker();
          return;
        }

        this.titleEl.setText("调整横幅");
        this.contentEl.empty();
        const shell = this.contentEl.createDiv({ cls: "media-backdrop-editor" });
        shell.createDiv({
          cls: "media-backdrop-editor-hint",
          text: "拖动图片，调整作品页中显示的部分。"
        });

        const preview = shell.createDiv({
          cls: "media-backdrop-preview",
          attr: {
            tabindex: "0",
            role: "group",
            "aria-label": "横幅显示区域，可拖动图片或使用方向键调整"
          }
        });
        preview.style.setProperty("--media-backdrop-preview-ratio", String(previewRatio));
        const image = preview.createEl("img", {
          attr: { src: app.vault.getResourcePath(this.pendingFile), alt: "" }
        });
        preview.createDiv({ cls: "media-backdrop-preview-shade" });

        const updatePreview = () => {
          image.style.objectPosition = `${this.position.x}% ${this.position.y}%`;
        };
        updatePreview();

        let dragState = null;
        const startDrag = event => {
          if (!image.naturalWidth || !image.naturalHeight) return;
          const rect = preview.getBoundingClientRect();
          const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
          dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            position: { ...this.position },
            overflowX: Math.max(0, image.naturalWidth * scale - rect.width),
            overflowY: Math.max(0, image.naturalHeight * scale - rect.height)
          };
          preview.setPointerCapture(event.pointerId);
          preview.addClass("is-dragging");
          event.preventDefault();
        };
        const moveDrag = event => {
          if (!dragState || event.pointerId !== dragState.pointerId) return;
          if (dragState.overflowX > 0.5) {
            this.position.x = clamp(
              dragState.position.x - (event.clientX - dragState.startX) / dragState.overflowX * 100,
              0,
              100
            );
          }
          if (dragState.overflowY > 0.5) {
            this.position.y = clamp(
              dragState.position.y - (event.clientY - dragState.startY) / dragState.overflowY * 100,
              0,
              100
            );
          }
          updatePreview();
          event.preventDefault();
        };
        const endDrag = event => {
          if (!dragState || event.pointerId !== dragState.pointerId) return;
          if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
          dragState = null;
          preview.removeClass("is-dragging");
        };

        preview.addEventListener("pointerdown", startDrag);
        preview.addEventListener("pointermove", moveDrag);
        preview.addEventListener("pointerup", endDrag);
        preview.addEventListener("pointercancel", endDrag);
        preview.addEventListener("keydown", event => {
          const step = event.shiftKey ? 10 : 2;
          const deltas = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step]
          };
          const delta = deltas[event.key];
          if (!delta) return;
          this.position.x = clamp(this.position.x + delta[0], 0, 100);
          this.position.y = clamp(this.position.y + delta[1], 0, 100);
          updatePreview();
          event.preventDefault();
        });

        const tools = shell.createDiv({ cls: "media-backdrop-editor-tools" });
        tools.createEl("button", { text: "重新选择", attr: { type: "button" } })
          .addEventListener("click", () => this.renderPicker());
        tools.createEl("button", { text: "恢复居中", attr: { type: "button" } })
          .addEventListener("click", () => {
            this.position = { x: 50, y: 50 };
            updatePreview();
            preview.focus();
          });

        const footer = shell.createDiv({ cls: "media-backdrop-editor-footer" });
        if (liveBackdropPath) {
          const removeButton = footer.createEl("button", {
            cls: "media-backdrop-remove",
            text: "移除横幅",
            attr: { type: "button" }
          });
          removeButton.addEventListener("click", async () => {
            removeButton.disabled = true;
            if (await removeBackdrop()) this.close();
            else removeButton.disabled = false;
          });
        } else {
          footer.createSpan();
        }

        const decisions = footer.createDiv({ cls: "media-backdrop-editor-decisions" });
        decisions.createEl("button", { text: "取消", attr: { type: "button" } })
          .addEventListener("click", () => this.close());
        const saveButton = decisions.createEl("button", {
          cls: "mod-cta",
          text: "保存",
          attr: { type: "button" }
        });
        saveButton.addEventListener("click", async () => {
          saveButton.disabled = true;
          if (await saveBackdrop(this.pendingFile, this.position)) this.close();
          else saveButton.disabled = false;
        });
      }

      onClose() {
        this.contentEl.empty();
      }
    }

    new BackdropEditorModal().open();
  };

  button.addEventListener("click", openEditor);
  syncButton();
};

mountBackdropControl();

const mountRating = host => {
  host.empty();
  host.addClass("is-ready");

  let savedRating = typeof page.rating === "number" ? clamp(Math.round(page.rating * 2) / 2, 0, 5) : 0;
  let previewRating = savedRating;
  let pointerActive = false;
  let isSaving = false;

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
    clearButton.disabled = isSaving;
  };

  const setSaving = saving => {
    isSaving = saving;
    host.classList.toggle("is-saving", saving);
    stars.setAttr("aria-busy", String(saving));
    stars.setAttr("aria-disabled", String(saving));
    clearButton.disabled = saving;
  };

  const ratingFromPointer = event => {
    const bounds = stars.getBoundingClientRect();
    const position = clamp(event.clientX - bounds.left, 0, bounds.width);
    return clamp(Math.ceil((position / bounds.width) * 10) / 2, 0.5, 5);
  };

  const commit = async value => {
    if (isSaving) return false;
    const previous = savedRating;
    const next = clamp(Math.round(value * 2) / 2, 0, 5);
    if (next === previous) {
      render(previous);
      return true;
    }

    savedRating = next;
    render(next);
    personalNumber.setText(next > 0 ? String(next) : "—");
    setSaving(true);
    let workSaved = false;
    try {
      await writeField("rating", next > 0 ? next : null);
      workSaved = true;
      await syncEndedSnapshot();
      return true;
    } catch (error) {
      console.error("评分保存失败", error);
      let rollbackFailed = false;
      if (workSaved) {
        try {
          await writeField("rating", previous > 0 ? previous : null);
        } catch (rollbackError) {
          rollbackFailed = true;
          console.error("评分同步失败，且作品评分回滚失败", rollbackError);
        }
      }
      if (rollbackFailed) {
        showNotice("作品评分已修改，但当前体验记录同步失败，请重试");
        return false;
      }
      savedRating = previous;
      render(previous);
      personalNumber.setText(previous > 0 ? String(previous) : "—");
      showNotice(`评分与当前记录同步失败，已恢复为${previous > 0 ? ` ${previous} 星` : "未评分"}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  stars.addEventListener("pointermove", event => {
    if (isSaving) return;
    render(ratingFromPointer(event), true);
  });

  stars.addEventListener("pointerleave", () => {
    if (!pointerActive) render(savedRating);
  });

  stars.addEventListener("pointerdown", event => {
    if (isSaving) return;
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
    if (isSaving) return;
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
    if (isSaving) return;
    void commit(0);
  });

  const ratingCallout = host.closest('.callout[data-callout="media-control"]');
  ratingCallout?.addEventListener("media-experience-started", () => {
    savedRating = 0;
    previewRating = 0;
    render(0);
    personalNumber.setText("—");
  });

  render(savedRating);
};

const mountProgress = host => {
  host.empty();
  host.addClass("is-ready");

  const config = progressConfigs[workFormat];
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
  let isSaving = false;
  let pendingProgress = null;
  let statusWasDisabled = false;
  let statusNeedsSync = false;

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
  const completeButton = host.createEl("button", {
    cls: "media-progress-complete",
    text: "标记完成",
    attr: { type: "button", "aria-label": "确认将状态设为已完成" }
  });
  const hint = host.createSpan({
    cls: "media-progress-hint",
    text: hasTotal
      ? "进度满后可确认完成；状态设为已完成也会补满进度；从满值减少会恢复为进行中"
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
    decrement.disabled = isSaving || current <= 0;
    increment.disabled = isSaving || (hasTotal && current >= total);
    input.disabled = isSaving;
    const canComplete = hasTotal && current >= total && currentStatus !== "已完成";
    completeButton.hidden = !canComplete;
    completeButton.disabled = isSaving || !canComplete;
    return current;
  };

  const setSaving = saving => {
    isSaving = saving;
    host.classList.toggle("is-saving", saving);
    host.setAttr("aria-busy", String(saving));
    if (statusControl) {
      if (saving) statusWasDisabled = statusControl.disabled;
      statusControl.disabled = saving || statusWasDisabled;
    }
    render(savedProgress);
  };

  const commit = async (value, options = {}) => {
    if (isSaving) {
      pendingProgress = value;
      return false;
    }
    const previousProgress = savedProgress;
    const previousStatus = currentStatus;
    const previousFinishedAt = liveFinishedAt;
    const next = render(value);
    if (next === previousProgress) return true;
    savedProgress = next;
    const updates = {
      [config.field]: savedProgress,
      experience_index: liveExperienceIndex
    };
    if (options.recordActivity !== false) updates.last_activity_at = localToday();
    const shouldResume = hasTotal && savedProgress < total && currentStatus === "已完成";
    if (shouldResume) {
      currentStatus = "进行中";
      updates.status = currentStatus;
      updates.finished_at = null;
      if (statusControl) statusControl.value = currentStatus;
    }
    setSaving(true);
    try {
      await writeFields(updates);
      if (shouldResume) {
        await withdrawExperienceSnapshot(liveExperienceIndex);
        liveFinishedAt = "";
        const callout = host.closest('.callout[data-callout="media-control"]');
        callout?.dispatchEvent(new CustomEvent("media-experience-reopened"));
        showNotice("已重新打开当前记录，状态恢复为进行中");
      } else if (currentStatus === "已完成" || currentStatus === "弃置") {
        await syncEndedSnapshot();
      }
      return true;
    } catch (error) {
      console.error("进度保存失败", error);
      try {
        await writeFields({
          [config.field]: previousProgress,
          status: previousStatus,
          finished_at: previousFinishedAt || null
        });
      } catch (rollbackError) {
        console.error("进度回滚失败", rollbackError);
      }
      savedProgress = previousProgress;
      currentStatus = previousStatus;
      liveFinishedAt = previousFinishedAt;
      render(previousProgress);
      if (shouldResume && statusControl) statusControl.value = previousStatus;
      showNotice(`进度保存失败，已恢复为 ${previousProgress}${config.unit}`);
      return false;
    } finally {
      setSaving(false);
      if (pendingProgress !== null) {
        const queued = pendingProgress;
        pendingProgress = null;
        window.setTimeout(() => void commit(queued), 0);
      }
    }
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

  completeButton.addEventListener("click", async () => {
    if (isSaving || !hasTotal || savedProgress < total || currentStatus === "已完成") return;
    const previousStatus = currentStatus;
    let completionDate = liveFinishedAt;
    let shouldRecordDate = false;
    setSaving(true);
    try {
      await writeFrontmatter(frontmatter => {
        completionDate = dateText(frontmatter.finished_at) || localToday();
        shouldRecordDate = !dateText(frontmatter.finished_at);
        frontmatter.experience_index = experienceIndexFrom(frontmatter.experience_index);
        frontmatter.status = "已完成";
        frontmatter.last_activity_at = dateText(frontmatter.last_activity_at) || completionDate;
        if (shouldRecordDate) frontmatter.finished_at = completionDate;
      });
      currentStatus = "已完成";
      liveFinishedAt = completionDate;
      if (statusControl) statusControl.value = currentStatus;
      else statusNeedsSync = true;
      const callout = host.closest('.callout[data-callout="media-control"]');
      callout?.dispatchEvent(new CustomEvent("media-progress-status-saved", {
        detail: { status: currentStatus, finishedAt: completionDate }
      }));
      render(savedProgress);
      showNotice(shouldRecordDate ? "已标记为已完成，并记录完成日期" : "已标记为已完成");
    } catch (error) {
      console.error("完成状态保存失败", error);
      currentStatus = previousStatus;
      if (statusControl) statusControl.value = previousStatus;
      render(savedProgress);
      showNotice(`状态保存失败，仍保持为“${plainText(previousStatus) || "原状态"}”`);
    } finally {
      setSaving(false);
    }
  });

  const attachCompletionSync = () => {
    const callout = host.closest('.callout[data-callout="media-control"]');
    const statusSelect = Array.from(callout?.querySelectorAll("select") || []).find(select =>
      Array.from(select.options || []).some(option => option.value === "已完成"));
    if (!statusSelect || statusSelect.dataset.mediaProgressSync === "true") return false;
    statusControl = statusSelect;
    if (statusNeedsSync) {
      statusControl.value = currentStatus;
      statusNeedsSync = false;
    } else {
      currentStatus = statusSelect.value || currentStatus;
    }
    statusSelect.dataset.mediaProgressSync = "true";
    statusSelect.addEventListener("change", () => {
      currentStatus = statusSelect.value;
      render(savedProgress);
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
  const progressCallout = host.closest('.callout[data-callout="media-control"]');
  progressCallout?.addEventListener("media-experience-started", () => {
    savedProgress = 0;
    pendingProgress = null;
    currentStatus = "进行中";
    if (statusControl) statusControl.value = currentStatus;
    else statusNeedsSync = true;
    render(savedProgress);
  });
  if (page.status === "已完成" && hasTotal && savedProgress < total) void commit(total, { recordActivity: false });
};

const dateLabels = {
  book: { started: "开始阅读", finished: "读完日期" },
  tv: { started: "开始追剧", finished: "看完日期" },
  movie: { started: "开始观看", finished: "看完日期" },
  anime: { started: "开始追番", finished: "看完日期" },
  game: { started: "开始游玩", finished: "通关日期" },
  variety: { started: "开始观看", finished: "看完日期" },
  documentary: { started: "开始观看", finished: "看完日期" }
};

const localToday = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const experienceLabels = {
  book: { noun: "阅读", next: "开始重读" },
  tv: { noun: "观看", next: "开始重看" },
  movie: { noun: "观看", next: "开始重看" },
  anime: { noun: "观看", next: "开始重看" },
  game: { noun: "游玩", next: "开始重玩" },
  variety: { noun: "观看", next: "开始重看" },
  documentary: { noun: "观看", next: "开始重看" }
};

const experienceIndexFrom = value => Math.max(1, Math.round(numberFrom(value)) || 1);

const linkTarget = value => {
  const raw = value?.path ?? String(value || "");
  return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].replace(/\.md$/i, "");
};

const experienceFiles = () => app.vault.getMarkdownFiles().filter(file => file.path.startsWith("媒体库/记录/"));

const experienceFrontmatter = file => app.metadataCache.getFileCache(file)?.frontmatter || {};

const experienceBelongsToWork = (file, frontmatter) => {
  if (frontmatter.note_type !== "media_experience") return false;
  const target = linkTarget(frontmatter.work);
  const resolved = target ? app.metadataCache.getFirstLinkpathDest(target, file.path) : null;
  return resolved?.path === page.file.path || `${target}.md` === page.file.path || target === page.file.path;
};

const experienceMatchesWork = (file, frontmatter, index) =>
  experienceBelongsToWork(file, frontmatter) && experienceIndexFrom(frontmatter.experience_index) === index;

const findExperienceFile = index => experienceFiles().find(file =>
  experienceMatchesWork(file, experienceFrontmatter(file), index));

const ensureFolder = async folderPath => {
  let current = "";
  for (const part of folderPath.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch (error) {
        if (!app.vault.getAbstractFileByPath(current)) throw error;
      }
    }
  }
};

const yamlText = value => JSON.stringify(String(value ?? ""));

const historyProgress = frontmatter => {
  const config = progressConfigs[workFormat];
  if (!config) return { value: 0, total: 0, unit: "percent" };
  const total = config.fixedTotal ?? Math.max(0, Math.round(numberFrom(frontmatter[config.totalField])));
  const value = Math.max(0, Math.round(numberFrom(frontmatter[config.field])));
  return {
    value: total > 0 ? Math.min(value, total) : value,
    total,
    unit: config.historyUnit
  };
};

const createExperienceContent = data => {
  const label = experienceLabels[page.media_type]?.noun || "体验";
  const workPath = page.file.path.replace(/\.md$/i, "");
  const rating = numberFrom(data.experience_rating);
  return `---\nnote_type: media_experience\nwork: ${yamlText(`[[${workPath}|${page.title || page.file.name}]]`)}\nexperience_index: ${data.experience_index}\nresult: ${data.result}\nrecord_origin: ${data.record_origin}\ndate_certainty: ${data.date_certainty}\nyear_verified: ${data.year_verified}\nverified_year: ${data.verified_year || ""}\nstarted_at: ${data.started_at || ""}\nended_at: ${data.ended_at || ""}\nprogress_value: ${data.progress_value}\nprogress_total: ${data.progress_total || ""}\nprogress_unit: ${data.progress_unit}\nexperience_rating: ${rating > 0 ? rating : "null"}\nedition: ${data.edition ? yamlText(data.edition) : ""}\nplayed_on: []\ncreated_at: ${data.created_at}\ncssclasses:\n  - media-library-page\n---\n\n# ${page.title || page.file.name} · 第 ${data.experience_index} 次${label}\n\n[[${workPath}|← 返回作品]]\n\n## 本次记录\n\n\`\`\`dataviewjs\nawait dv.view("媒体库/视图/体验记录")\n\`\`\`\n\n`;
};

const upsertExperienceSnapshot = async (frontmatter, result, options = {}) => {
  const origin = options.origin
    || (Object.prototype.hasOwnProperty.call(frontmatter, "experience_index") ? "tracked" : "migrated");
  const migrated = origin === "migrated";
  const index = experienceIndexFrom(frontmatter.experience_index);
  const progress = historyProgress(frontmatter);
  let file = findExperienceFile(index);
  const existing = file ? experienceFrontmatter(file) : {};
  const endedAt = migrated
    ? dateText(frontmatter.finished_at)
    : result === "completed"
    ? (dateText(frontmatter.finished_at) || dateText(existing.ended_at) || localToday())
    : (dateText(existing.ended_at) || localToday());
  const startedAt = dateText(frontmatter.started_at);
  const verifiedYear = migrated ? 0 : Number(endedAt.slice(0, 4));
  const data = {
    experience_index: index,
    result,
    record_origin: origin,
    date_certainty: migrated ? (endedAt ? "approximate" : "unknown") : "exact",
    year_verified: !migrated,
    verified_year: verifiedYear,
    started_at: startedAt,
    ended_at: endedAt,
    progress_value: progress.value,
    progress_total: progress.total,
    progress_unit: progress.unit,
    experience_rating: frontmatter.rating,
    edition: frontmatter.edition,
    created_at: localToday()
  };

  if (!file) {
    const year = !migrated && /^\d{4}/.test(endedAt) ? endedAt.slice(0, 4) : "待确认";
    const folder = `媒体库/记录/${year}`;
    await ensureFolder(folder);
    const safeName = page.file.name.replace(/[\\/:*?"<>|#\[\]]/g, "-");
    const path = `${folder}/${safeName} · 第${index}次.md`;
    file = app.vault.getAbstractFileByPath(path);
    if (!file) file = await app.vault.create(path, createExperienceContent(data));
  }

  await app.fileManager.processFrontMatter(file, snapshot => {
    snapshot.note_type = "media_experience";
    snapshot.work = `[[${page.file.path.replace(/\.md$/i, "")}|${page.title || page.file.name}]]`;
    snapshot.experience_index = index;
    snapshot.result = result;
    if (!snapshot.record_origin) snapshot.record_origin = origin;
    if (snapshot.record_origin === "tracked") {
      snapshot.date_certainty = "exact";
      snapshot.year_verified = true;
      snapshot.verified_year = Number(endedAt.slice(0, 4));
    } else {
      if (!snapshot.date_certainty) snapshot.date_certainty = "approximate";
      if (snapshot.year_verified !== true) snapshot.year_verified = false;
      if (!snapshot.year_verified) snapshot.verified_year = null;
    }
    snapshot.started_at = startedAt || null;
    snapshot.ended_at = endedAt;
    snapshot.progress_value = progress.value;
    snapshot.progress_total = progress.total || null;
    snapshot.progress_unit = progress.unit;
    snapshot.experience_rating = numberFrom(frontmatter.rating) > 0 ? numberFrom(frontmatter.rating) : null;
    if (!Object.prototype.hasOwnProperty.call(snapshot, "edition")) snapshot.edition = frontmatter.edition || null;
    if (!Array.isArray(snapshot.played_on)) snapshot.played_on = [];
    if (!snapshot.created_at) snapshot.created_at = localToday();
  });

  return file;
};

const finalizeExperience = async result => {
  let data = {};
  let origin = "tracked";
  await writeFrontmatter(frontmatter => {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, "experience_index")) origin = "migrated";
    const index = experienceIndexFrom(frontmatter.experience_index);
    frontmatter.experience_index = index;
    liveExperienceIndex = index;
    if (result === "completed") {
      const config = progressConfigs[workFormat];
      const total = config ? (config.fixedTotal ?? Math.max(0, Math.round(numberFrom(frontmatter[config.totalField])))) : 0;
      frontmatter.status = "已完成";
      if (total > 0) frontmatter[config.field] = total;
      frontmatter.finished_at = dateText(frontmatter.finished_at) || (origin === "migrated" ? null : localToday());
      frontmatter.last_activity_at = dateText(frontmatter.last_activity_at) || frontmatter.finished_at || null;
      liveFinishedAt = dateText(frontmatter.finished_at);
    } else {
      frontmatter.status = "弃置";
      frontmatter.finished_at = null;
      frontmatter.last_activity_at = dateText(frontmatter.last_activity_at) || localToday();
      liveFinishedAt = "";
    }
    data = { ...frontmatter };
  });
  return upsertExperienceSnapshot(data, result, { origin });
};

const syncEndedSnapshot = async () => {
  let data = {};
  await writeFrontmatter(frontmatter => {
    data = { ...frontmatter };
  });
  if (data.status === "已完成") return upsertExperienceSnapshot(data, "completed");
  if (data.status === "弃置") return upsertExperienceSnapshot(data, "abandoned");
  return null;
};

const withdrawExperienceSnapshot = async index => {
  const file = findExperienceFile(index);
  if (!file) return false;
  if (typeof app.fileManager.trashFile === "function") await app.fileManager.trashFile(file);
  else await app.vault.trash(file, true);
  return true;
};

const refreshDataview = () => {
  try {
    app.workspace.trigger("dataview:refresh-views");
  } catch (error) {
    console.error("刷新作品页失败", error);
  }
};

const mountDateControls = note => {
  const callout = note.querySelector('.callout[data-callout="media-control"]');
  const content = callout?.querySelector(".callout-content");
  if (!content || content.querySelector(".media-date-row")) return;

  const labels = dateLabels[page.media_type] || { started: "开始日期", finished: "完成日期" };
  const values = {
    started_at: dateText(page.started_at),
    finished_at: dateText(page.finished_at)
  };
  const controls = {};
  const pendingDates = new Set();

  const row = content.createDiv({ cls: "media-date-row" });
  row.createSpan({ cls: "media-date-row-label", text: "日期" });
  const fields = row.createDiv({ cls: "media-date-fields" });

  const createField = (field, labelText) => {
    const group = fields.createDiv({ cls: "media-date-field" });
    group.createSpan({ cls: "media-date-field-label", text: labelText });
    const input = group.createEl("input", {
      cls: "media-date-input",
      attr: { type: "date", "aria-label": labelText }
    });
    input.value = values[field] || "";

    const clear = group.createEl("button", {
      cls: "media-date-clear clickable-icon",
      attr: { type: "button", "aria-label": `清除${labelText}`, title: `清除${labelText}` }
    });
    setAppIcon(clear, "x", "×");

    const renderClear = () => clear.classList.toggle("is-visible", Boolean(input.value));
    const commit = async value => {
      const previous = values[field];
      const normalized = value || "";
      values[field] = normalized;
      input.value = normalized;
      renderClear();
      try {
        await writeField(field, normalized || null);
        if (field === "finished_at") liveFinishedAt = normalized;
        if (field === "started_at" || (field === "finished_at" && normalized)) {
          await syncEndedSnapshot();
        }
        return true;
      } catch (error) {
        console.error(`日期字段 ${field} 与当前记录同步失败`, error);
        try {
          await writeField(field, previous || null);
        } catch (rollbackError) {
          console.error(`日期字段 ${field} 回滚失败`, rollbackError);
        }
        values[field] = previous;
        input.value = previous;
        if (field === "finished_at") liveFinishedAt = previous;
        renderClear();
        showNotice(`${labelText}与当前记录同步失败，已恢复原值`);
        return false;
      }
    };

    input.addEventListener("input", renderClear);
    input.addEventListener("change", () => void commit(input.value));
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") input.blur();
    });
    clear.addEventListener("click", () => void commit(""));

    renderClear();
    controls[field] = { input, commit };
  };

  createField("started_at", labels.started);
  createField("finished_at", labels.finished);

  callout.addEventListener("media-progress-status-saved", event => {
    if (event.detail?.status !== "已完成") return;
    const finishedAt = String(event.detail.finishedAt || "");
    values.finished_at = finishedAt;
    controls.finished_at.input.value = finishedAt;
    controls.finished_at.input.dispatchEvent(new Event("input"));
  });

  callout.addEventListener("media-experience-reopened", () => {
    values.finished_at = "";
    controls.finished_at.input.value = "";
    controls.finished_at.input.dispatchEvent(new Event("input"));
  });

  callout.addEventListener("media-finished-date-cleared", () => {
    values.finished_at = "";
    controls.finished_at.input.value = "";
    controls.finished_at.input.dispatchEvent(new Event("input"));
  });

  callout.addEventListener("media-experience-started", event => {
    const startedAt = String(event.detail?.startedAt || localToday());
    values.started_at = startedAt;
    values.finished_at = "";
    controls.started_at.input.value = startedAt;
    controls.finished_at.input.value = "";
    controls.started_at.input.dispatchEvent(new Event("input"));
    controls.finished_at.input.dispatchEvent(new Event("input"));
  });

  const recordDateForStatus = (field, labelText) => {
    if (values[field] || pendingDates.has(field)) return;
    pendingDates.add(field);
    const today = localToday();
    controls[field].input.value = today;
    controls[field].input.dispatchEvent(new Event("input"));
    window.setTimeout(async () => {
      const saved = await controls[field].commit(today);
      pendingDates.delete(field);
      if (saved) showNotice(`${labelText}已记录为今天`);
    }, 80);
  };

  const attachStatusSync = () => {
    const statusSelect = Array.from(callout.querySelectorAll("select")).find(select =>
      Array.from(select.options || []).some(option => option.value === "已完成"));
    if (!statusSelect || statusSelect.dataset.mediaDateSync === "true") return false;
    statusSelect.dataset.mediaDateSync = "true";
    statusSelect.addEventListener("change", () => {
      if (statusSelect.value === "进行中") {
        recordDateForStatus("started_at", labels.started);
      } else if (statusSelect.value === "已完成") {
        recordDateForStatus("finished_at", labels.finished);
      }
    });
    return true;
  };

  if (!attachStatusSync()) window.setTimeout(attachStatusSync, 180);
};

const mountExperienceHistory = note => {
  const callout = note.querySelector('.callout[data-callout="media-control"]');
  const content = callout?.querySelector(".callout-content");
  if (!content || content.querySelector(".media-experience-section")) return;

  const labels = experienceLabels[page.media_type] || { noun: "体验", next: "开始下一次体验" };
  let currentIndex = liveExperienceIndex;
  let liveStatus = page.status || "待体验";
  let isBusy = false;

  const section = content.createDiv({ cls: "media-experience-section" });
  const header = section.createDiv({ cls: "media-experience-header" });
  const identity = header.createDiv({ cls: "media-experience-identity" });
  identity.createSpan({ cls: "media-experience-label", text: "体验记录" });
  const currentBadge = identity.createSpan({ cls: "media-experience-current" });

  const actions = header.createDiv({ cls: "media-experience-actions" });
  const nextButton = actions.createEl("button", {
    cls: "media-experience-next",
    text: labels.next,
    attr: { type: "button" }
  });

  const confirmation = section.createDiv({ cls: "media-experience-confirm" });
  confirmation.hidden = true;
  const confirmationText = confirmation.createSpan();
  const confirmationButtons = confirmation.createDiv({ cls: "media-experience-confirm-actions" });
  const cancelButton = confirmationButtons.createEl("button", {
    cls: "media-experience-cancel",
    text: "取消",
    attr: { type: "button" }
  });
  const confirmButton = confirmationButtons.createEl("button", {
    cls: "media-experience-confirm-button",
    text: "确认开始",
    attr: { type: "button" }
  });

  const history = section.createDiv({ cls: "media-experience-history" });

  const recordsForWork = () => experienceFiles()
    .map(file => ({ file, frontmatter: experienceFrontmatter(file) }))
    .filter(record => experienceBelongsToWork(record.file, record.frontmatter))
    .sort((left, right) => experienceIndexFrom(right.frontmatter.experience_index) - experienceIndexFrom(left.frontmatter.experience_index));

  const openRecord = (file, event) => {
    event.preventDefault();
    void app.workspace.openLinkText(file.path, page.file.path, false);
  };

  const renderHistory = () => {
    currentBadge.setText(`第 ${currentIndex} 次${labels.noun}`);
    const ended = liveStatus === "已完成" || liveStatus === "弃置";
    nextButton.hidden = !ended;
    nextButton.disabled = isBusy;
    history.empty();

    const records = recordsForWork();
    if (!records.length) {
      const empty = history.createDiv({ cls: "media-experience-empty" });
      empty.createSpan({ text: ended ? "当前记录尚未写入历史，可重试保存或直接开始下一次。" : "完成或弃置当前体验后，会在这里生成历史记录。" });
      if (ended) {
        const retry = empty.createEl("button", {
          cls: "media-experience-retry",
          text: "重试保存",
          attr: { type: "button" }
        });
        retry.disabled = isBusy;
        retry.addEventListener("click", async () => {
          if (isBusy) return;
          isBusy = true;
          renderHistory();
          try {
            await finalizeExperience(liveStatus === "弃置" ? "abandoned" : "completed");
            window.setTimeout(renderHistory, 180);
            showNotice("历史记录已保存");
          } catch (error) {
            console.error("历史记录保存失败", error);
            showNotice("历史记录保存失败，作品当前状态未受影响");
          } finally {
            isBusy = false;
            window.setTimeout(renderHistory, 220);
          }
        });
      }
      return;
    }

    for (const record of records) {
      const meta = record.frontmatter;
      const index = experienceIndexFrom(meta.experience_index);
      const item = history.createDiv({ cls: "media-experience-item" });
      const main = item.createEl("a", {
        cls: "media-experience-open",
        text: `第 ${index} 次${labels.noun}`,
        href: record.file.path
      });
      main.addEventListener("click", event => openRecord(record.file, event));
      const resultLabel = meta.result === "abandoned" ? "已弃置" : "已完成";
      const dates = [dateText(meta.started_at), dateText(meta.ended_at)].filter(Boolean);
      const certainty = String(meta.date_certainty || "");
      const yearVerified = meta.year_verified === true;
      const verifiedYear = Math.round(numberFrom(meta.verified_year));
      const dateRange = dates.join(" — ");
      const dateLabel = dateRange
        ? (!yearVerified
          ? `${dateRange}（待确认）`
          : (certainty === "approximate" ? `${verifiedYear || "年份"} 已确认，具体日期约` : dateRange))
        : (!yearVerified ? "日期未知（待确认）" : `${verifiedYear || "年份"} 已确认，具体日期未知`);
      const details = [resultLabel, dateLabel].filter(Boolean);
      const rating = numberFrom(meta.experience_rating);
      if (rating > 0) details.push(`${rating} 星`);
      item.createDiv({ cls: "media-experience-meta", text: details.join(" · ") });
    }
  };

  const setBusy = busy => {
    isBusy = busy;
    section.classList.toggle("is-saving", busy);
    nextButton.disabled = busy;
    cancelButton.disabled = busy;
    confirmButton.disabled = busy;
  };

  nextButton.addEventListener("click", () => {
    confirmationText.setText(`将保存第 ${currentIndex} 次${labels.noun}，并清空当前评分、进度和本次日期。`);
    confirmation.hidden = false;
    nextButton.hidden = true;
  });

  cancelButton.addEventListener("click", () => {
    confirmation.hidden = true;
    renderHistory();
  });

  confirmButton.addEventListener("click", async () => {
    if (isBusy || (liveStatus !== "已完成" && liveStatus !== "弃置")) return;
    setBusy(true);
    try {
      const result = liveStatus === "弃置" ? "abandoned" : "completed";
      await finalizeExperience(result);
      const today = localToday();
      let nextIndex = currentIndex + 1;
      await writeFrontmatter(frontmatter => {
        const actualIndex = experienceIndexFrom(frontmatter.experience_index);
        nextIndex = actualIndex + 1;
        frontmatter.experience_index = nextIndex;
        frontmatter.status = "进行中";
        frontmatter.rating = null;
        frontmatter.started_at = today;
        frontmatter.finished_at = null;
        frontmatter.last_activity_at = today;
        const config = progressConfigs[workFormat];
        if (config) frontmatter[config.field] = 0;
      });
      currentIndex = nextIndex;
      liveExperienceIndex = nextIndex;
      liveStatus = "进行中";
      liveFinishedAt = "";
      callout.dispatchEvent(new CustomEvent("media-experience-started", {
        detail: { experienceIndex: nextIndex, startedAt: today }
      }));
      confirmation.hidden = true;
      setBusy(false);
      renderHistory();
      showNotice(`已开始第 ${nextIndex} 次${labels.noun}`);
      refreshDataview();
    } catch (error) {
      console.error("开始下一次体验失败", error);
      showNotice("开始下一次体验失败，原有记录和进度保持不变");
      setBusy(false);
      renderHistory();
    }
  });

  const syncEndedExperience = async result => {
    if (isBusy) return;
    setBusy(true);
    renderHistory();
    try {
      await new Promise(resolve => window.setTimeout(resolve, 360));
      await finalizeExperience(result);
      liveStatus = result === "completed" ? "已完成" : "弃置";
      currentIndex = liveExperienceIndex;
      if (result === "abandoned") callout.dispatchEvent(new CustomEvent("media-finished-date-cleared"));
      window.setTimeout(renderHistory, 180);
    } catch (error) {
      console.error("体验历史保存失败", error);
      showNotice("当前状态已保存，但体验历史保存失败，可在记录区重试");
    } finally {
      setBusy(false);
      window.setTimeout(renderHistory, 180);
    }
  };

  callout.addEventListener("media-progress-status-saved", event => {
    if (event.detail?.status !== "已完成") return;
    liveStatus = "已完成";
    void syncEndedExperience("completed");
  });

  callout.addEventListener("media-experience-reopened", () => {
    liveStatus = "进行中";
    window.setTimeout(renderHistory, 160);
  });

  const attachStatusSync = () => {
    const statusSelect = Array.from(callout.querySelectorAll("select")).find(select =>
      Array.from(select.options || []).some(option => option.value === "已完成"));
    if (!statusSelect || statusSelect.dataset.mediaExperienceSync === "true") return false;
    statusSelect.dataset.mediaExperienceSync = "true";
    statusSelect.addEventListener("change", async () => {
      const previousStatus = liveStatus;
      const nextStatus = statusSelect.value;
      liveStatus = nextStatus;
      renderHistory();
      if (nextStatus === "已完成") {
        void syncEndedExperience("completed");
        return;
      }
      if (nextStatus === "弃置") {
        void syncEndedExperience("abandoned");
        return;
      }
      if (previousStatus !== "已完成" && previousStatus !== "弃置") return;
      try {
        if (previousStatus === "已完成") {
          await writeField("finished_at", null);
          liveFinishedAt = "";
        }
        await withdrawExperienceSnapshot(currentIndex);
        callout.dispatchEvent(new CustomEvent("media-experience-reopened"));
      } catch (error) {
        console.error("撤销当前体验快照失败", error);
        showNotice("重新打开当前记录失败，请稍后重试");
      }
    });
    return true;
  };

  renderHistory();
  if (!attachStatusSync()) window.setTimeout(attachStatusSync, 180);
};

const mountInteractiveControls = () => {
  const note = dv.container.closest(".media-library-note");
  if (!note) return;
  note.querySelectorAll(".media-rating-control:not(.is-ready)").forEach(mountRating);
  note.querySelectorAll(".media-progress-control:not(.is-ready)").forEach(mountProgress);
  mountDateControls(note);
  mountExperienceHistory(note);
};

window.requestAnimationFrame(() => window.requestAnimationFrame(mountInteractiveControls));
window.setTimeout(mountInteractiveControls, 120);
