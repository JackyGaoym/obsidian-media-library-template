const THEME_MODES = new Set(["system", "light", "dark"]);
const vaultName = app.vault.getName();
const storageKey = `media-library-theme-mode:${vaultName}`;
const controllers = window.__mediaLibraryThemeControllers
  || (window.__mediaLibraryThemeControllers = new Map());

const storedMode = () => {
  try {
    const value = window.localStorage.getItem(storageKey);
    return THEME_MODES.has(value) ? value : "system";
  } catch (error) {
    console.warn("Unable to read the media library theme preference.", error);
    return "system";
  }
};

const obsidianTheme = () => document.body.classList.contains("theme-light")
  ? "light"
  : "dark";

if (!controllers.has(vaultName)) {
  const apply = mode => {
    const normalizedMode = THEME_MODES.has(mode) ? mode : "system";
    const effectiveTheme = normalizedMode === "system" ? obsidianTheme() : normalizedMode;
    document.body.dataset.mediaLibraryThemeMode = normalizedMode;
    document.body.dataset.mediaLibraryTheme = effectiveTheme;
    document.dispatchEvent(new CustomEvent("media-library-theme-change", {
      detail: { mode: normalizedMode, theme: effectiveTheme, vaultName }
    }));
  };

  const controller = {
    getMode: storedMode,
    apply() {
      apply(storedMode());
    },
    setMode(mode) {
      const normalizedMode = THEME_MODES.has(mode) ? mode : "system";
      try {
        window.localStorage.setItem(storageKey, normalizedMode);
      } catch (error) {
        console.warn("Unable to save the media library theme preference.", error);
      }
      apply(normalizedMode);
    }
  };

  controller.observer = new MutationObserver(() => {
    if (controller.getMode() === "system") controller.apply();
  });
  controller.observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"]
  });
  controllers.set(vaultName, controller);
}

controllers.get(vaultName).apply();

await dv.view("媒体库/视图/类型");
