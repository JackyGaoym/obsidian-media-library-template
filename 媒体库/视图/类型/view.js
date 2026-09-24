await dv.view("媒体库/视图/导入适配");

const vaultName = app.vault.getName();

const MEDIA_TYPE_CONFIG_PATH = "媒体库/配置/作品类型.json";
const MEDIA_TYPE_DEFAULTS = [
  {
    id: "book",
    label: "图书",
    unit: "本",
    icon: "book-open",
    color: "#f4c56a",
    path: "媒体库/导航/图书",
    quickAddChoiceId: "2dc58115-8a58-4f8c-bde0-955aa536f301",
    format: "book",
    defaultEnabled: true,
    subtitle: "书名、作者、类型、出版时间、封面与阅读进度。",
    pending: "待阅读",
    active: "阅读中",
    add: "新增图书"
  },
  {
    id: "tv",
    label: "电视剧",
    unit: "部",
    icon: "tv",
    color: "#7aa8ff",
    path: "媒体库/导航/电视剧",
    quickAddChoiceId: "e2631a3e-a7c7-4af4-9738-940633b4886e",
    format: "series",
    defaultEnabled: true,
    subtitle: "剧名、首播时间、类型、集数、海报与追剧进度。",
    pending: "待观看",
    active: "追剧中",
    add: "新增电视剧"
  },
  {
    id: "movie",
    label: "电影",
    unit: "部",
    icon: "clapperboard",
    color: "#ff7f87",
    path: "媒体库/导航/电影",
    quickAddChoiceId: "33231650-d582-48a1-900f-085e860da8e4",
    format: "movie",
    defaultEnabled: true,
    subtitle: "电影名、上映时间、类型、时长、海报与观看进度。",
    pending: "待观看",
    active: "观看中",
    add: "新增电影"
  },
  {
    id: "anime",
    label: "动漫",
    unit: "部",
    icon: "sparkles",
    color: "#62d4eb",
    path: "媒体库/导航/动漫",
    quickAddChoiceId: "50e56c7d-c88b-42ab-bf88-567391f9e123",
    format: "series",
    defaultEnabled: true,
    subtitle: "TV 动画、网络动画与 OVA；动画电影和剧场版归入电影。",
    pending: "待观看",
    active: "追番中",
    add: "新增动漫"
  },
  {
    id: "game",
    label: "游戏",
    unit: "款",
    icon: "gamepad-2",
    color: "#63d49a",
    path: "媒体库/导航/游戏",
    quickAddChoiceId: "2dc5c9ae-85bd-4c07-9108-daf6d17a08b1",
    format: "game",
    defaultEnabled: true,
    subtitle: "游戏名、类型、平台、封面、开发商与完成进度。",
    pending: "待游玩",
    active: "游玩中",
    add: "新增游戏"
  },
  {
    id: "variety",
    label: "综艺",
    unit: "部",
    icon: "mic-2",
    color: "#e56bb3",
    path: "媒体库/导航/综艺",
    quickAddChoiceId: "a5b9e3c7-8db9-4b11-98de-7a97052c9c71",
    format: "series",
    flexibleFormat: true,
    defaultEnabled: false,
    subtitle: "综艺节目与特别节目；豆瓣导入后自动按单部或剧集记录。",
    pending: "待观看",
    active: "观看中",
    add: "新增综艺"
  },
  {
    id: "documentary",
    label: "纪录片",
    unit: "部",
    icon: "camera",
    color: "#6f8fe8",
    path: "媒体库/导航/纪录片",
    quickAddChoiceId: "53ef2d64-c2a3-44a3-87c6-9049c70f38b5",
    format: "movie",
    flexibleFormat: true,
    defaultEnabled: false,
    subtitle: "纪录电影与纪录剧集；豆瓣导入后自动选择时长或集数。",
    pending: "待观看",
    active: "观看中",
    add: "新增纪录片"
  }
];

const typeControllers = window.__mediaLibraryTypeControllers
  || (window.__mediaLibraryTypeControllers = new Map());
const MEDIA_TYPE_CONTROLLER_VERSION = 7;
const existingTypeController = typeControllers.get(vaultName);
if (existingTypeController && existingTypeController.version !== MEDIA_TYPE_CONTROLLER_VERSION) {
  existingTypeController.cancelPendingImport?.();
  typeControllers.delete(vaultName);
}

if (!typeControllers.has(vaultName)) {
  const defaultsById = new Map(MEDIA_TYPE_DEFAULTS.map(type => [type.id, Object.freeze({ ...type })]));
  const defaultConfig = () => ({
    version: 1,
    enabled: MEDIA_TYPE_DEFAULTS.filter(type => type.defaultEnabled).map(type => type.id),
    order: MEDIA_TYPE_DEFAULTS.map(type => type.id),
    customTypes: []
  });
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
  const normalizeConfig = raw => {
    const fallback = defaultConfig();
    const knownIds = new Set(MEDIA_TYPE_DEFAULTS.map(type => type.id));
    const enabled = [...new Set(Array.isArray(raw?.enabled) ? raw.enabled : fallback.enabled)]
      .filter(id => knownIds.has(id));
    const order = [...new Set([...(Array.isArray(raw?.order) ? raw.order : []), ...fallback.order])]
      .filter(id => knownIds.has(id));
    return {
      version: 1,
      enabled: enabled.length ? enabled : fallback.enabled,
      order,
      customTypes: Array.isArray(raw?.customTypes) ? raw.customTypes : []
    };
  };
  const readConfig = async () => {
    const file = app.vault.getAbstractFileByPath(MEDIA_TYPE_CONFIG_PATH);
    if (!file) return defaultConfig();
    try {
      return normalizeConfig(JSON.parse(await app.vault.read(file)));
    } catch (error) {
      console.warn("作品类型配置无法读取，已使用默认配置。", error);
      return defaultConfig();
    }
  };
  const writeConfig = async config => {
    const normalized = normalizeConfig(config);
    await ensureFolder(MEDIA_TYPE_CONFIG_PATH.split("/").slice(0, -1).join("/"));
    const content = `${JSON.stringify(normalized, null, 2)}\n`;
    const file = app.vault.getAbstractFileByPath(MEDIA_TYPE_CONFIG_PATH);
    if (file) await app.vault.modify(file, content);
    else await app.vault.create(MEDIA_TYPE_CONFIG_PATH, content);
    return normalized;
  };
  const inferFormat = page => {
    const explicit = String(page?.media_format || "");
    if (["book", "movie", "series", "game"].includes(explicit)) return explicit;
    const type = String(page?.media_type || "");
    if (type === "book") return "book";
    if (type === "movie") return "movie";
    if (type === "tv" || type === "anime") return "series";
    if (type === "game") return "game";
    if (Number(page?.episode_count || 0) > 0 || Number(page?.current_episode || 0) > 0) return "series";
    if (Number(page?.runtime_minutes || 0) > 0 || Number(page?.current_minutes || 0) > 0) return "movie";
    return defaultsById.get(type)?.format || "series";
  };

  const controller = {
    version: MEDIA_TYPE_CONTROLLER_VERSION,
    config: defaultConfig(),
    ready: null,
    getTypes(options = {}) {
      const includeDisabled = options.includeDisabled !== false;
      const ordered = this.config.order.map(id => defaultsById.get(id)).filter(Boolean);
      return includeDisabled ? ordered : ordered.filter(type => this.config.enabled.includes(type.id));
    },
    getBrowsableTypes(pages = []) {
      const withData = new Set(pages.map(page => String(page.media_type || "")));
      return this.getTypes().filter(type => this.isEnabled(type.id) || withData.has(type.id));
    },
    getType(id) {
      return defaultsById.get(String(id || "")) || null;
    },
    isEnabled(id) {
      return this.config.enabled.includes(String(id || ""));
    },
    inferFormat,
    progressType(page) {
      return inferFormat(page);
    },
    async saveEnabled(ids) {
      const valid = [...new Set(ids)].filter(id => defaultsById.has(id));
      if (!valid.length) throw new Error("至少需要启用一种作品类型");
      this.config = await writeConfig({ ...this.config, enabled: valid });
      document.dispatchEvent(new CustomEvent("media-library-types-change", {
        detail: { vaultName, enabled: [...valid] }
      }));
    },
    async launch(typeId, options = {}) {
      const type = defaultsById.get(typeId);
      return window.__mediaLibraryImportAdapter.launch(app, type, MEDIA_TYPE_DEFAULTS, options);
    }
  };
  controller.ready = readConfig().then(async config => {
    controller.config = normalizeConfig(config);
    if (!app.vault.getAbstractFileByPath(MEDIA_TYPE_CONFIG_PATH)) {
      controller.config = await writeConfig(controller.config);
    }
    return controller;
  });
  typeControllers.set(vaultName, controller);
}

await typeControllers.get(vaultName).ready;
