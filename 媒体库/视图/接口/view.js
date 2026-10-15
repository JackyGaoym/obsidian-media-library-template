// dv.view uses new Function(), which does not inherit a plugin's require().
// Resolve Obsidian through Dataview's supported inline-script renderer instead.
if (!window.__mediaLibraryObsidian?.Modal || !window.__mediaLibraryObsidian?.setIcon) {
  if (!window.__mediaLibraryObsidianReady) {
    window.__mediaLibraryObsidianReady = (async () => {
      try {
        const direct = typeof require === "function" ? require("obsidian") : null;
        if (direct?.Modal && direct?.setIcon) {
          window.__mediaLibraryObsidian = direct;
          return direct;
        }
      } catch (error) { /* Electron's global require may not resolve plugin modules. */ }
      const host = dv.container.createDiv({ cls: "media-library-api-bridge" });
      host.hidden = true;
      let finish;
      const completed = new Promise(resolve => { finish = resolve; });
      const request = { resolve: finish, error: null };
      window.__mediaLibraryObsidianRequest = request;
      let timeout;
      try {
        await dv.api.executeJs(`
          const request = window.__mediaLibraryObsidianRequest;
          if (request) {
            try {
              const api = require("obsidian");
              if (!api?.Modal || !api?.setIcon) throw new Error("Obsidian 接口不完整");
              window.__mediaLibraryObsidian = api;
            } catch (error) { request.error = error; }
            finally { request.resolve(); }
          }
        `, host, dv.component, dv.currentFilePath || dv.current()?.file?.path || "");
        await Promise.race([completed, new Promise(resolve => { timeout = window.setTimeout(resolve, 2000); })]);
        if (!window.__mediaLibraryObsidian?.Modal) throw request.error || new Error("Obsidian 接口加载超时");
        return window.__mediaLibraryObsidian;
      } finally {
        window.clearTimeout(timeout);
        if (window.__mediaLibraryObsidianRequest === request) delete window.__mediaLibraryObsidianRequest;
        host.remove();
      }
    })();
  }
  try { await window.__mediaLibraryObsidianReady; }
  catch (error) {
    delete window.__mediaLibraryObsidianReady;
    console.error("媒体库交互接口加载失败", error);
  }
}
