const DOUBAN_COMMAND = "obsidian-douban-plugin:searcher-douban-import-and-create-file-movie-tv";
const WORK_FOLDER = "媒体库/作品/";
const SESSION_TIMEOUT = 5 * 60 * 1000;
const TYPE_LABELS = { variety: "综艺", documentary: "纪录片" };

const importAs = ({ app, obsidian }, typeId) => {
  const plugin = app.plugins?.plugins?.["obsidian-douban-plugin"];
  const handler = plugin?.doubanExtractHandler;
  if (!plugin?.getDoubanTextForCreateNewNoteForType || !handler?.handle) {
    new obsidian.Notice("无法打开豆瓣导入，请确认豆瓣插件已启用");
    return;
  }

  const sessions = window.__mediaLibraryDoubanImportSessions
    || (window.__mediaLibraryDoubanImportSessions = new Map());
  const vaultName = app.vault.getName();
  sessions.get(vaultName)?.cancel();

  const originalOpen = plugin.getDoubanTextForCreateNewNoteForType;
  const originalHandle = handler.handle;
  const session = {
    context: null,
    eventRef: null,
    timeoutId: null,
    closed: false,
    processing: false,
    pendingFiles: 0,
    handleSettled: false,
    cancel() {
      if (this.closed) return;
      this.closed = true;
      window.clearTimeout(this.timeoutId);
      if (this.eventRef) app.vault.offref(this.eventRef);
      if (plugin.getDoubanTextForCreateNewNoteForType === watchedOpen) {
        plugin.getDoubanTextForCreateNewNoteForType = originalOpen;
      }
      if (handler.handle === watchedHandle) handler.handle = originalHandle;
      if (sessions.get(vaultName) === this) sessions.delete(vaultName);
    }
  };

  // The Douban command creates a context for this one search. Capturing it
  // lets later imports through other entry points pass through untouched.
  const watchedOpen = function (context, searchType) {
    session.context = context;
    if (plugin.getDoubanTextForCreateNewNoteForType === watchedOpen) {
      plugin.getDoubanTextForCreateNewNoteForType = originalOpen;
    }
    return originalOpen.call(this, context, searchType);
  };

  const watchedHandle = function (item, context) {
    if (session.closed || context !== session.context || session.processing) {
      return originalHandle.call(this, item, context);
    }
    session.processing = true;
    if (handler.handle === watchedHandle) handler.handle = originalHandle;

    const sourceId = String(item?.id || "");
    if (!sourceId) {
      session.cancel();
      return originalHandle.call(this, item, context);
    }

    const checkFile = async file => {
      try {
        let frontmatter;
        for (let attempt = 0; attempt < 16 && !session.closed; attempt++) {
          frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
          if (frontmatter?.note_type === "media" && frontmatter?.source_id !== undefined) break;
          await new Promise(resolve => window.setTimeout(resolve, 250));
        }
        if (session.closed || frontmatter?.note_type !== "media"
          || frontmatter?.source !== "douban"
          || String(frontmatter.source_id) !== sourceId) return;

        const importedType = String(frontmatter.media_type || "");
        const format = importedType === "movie" ? "movie"
          : (["tv", "anime"].includes(importedType) ? "series"
            : (Number(frontmatter.episode_count || 0) > 0 ? "series"
              : (Number(frontmatter.runtime_minutes || 0) > 0 ? "movie"
                : (typeId === "variety" ? "series" : "movie"))));
        await app.fileManager.processFrontMatter(file, properties => {
          properties.media_type = typeId;
          properties.media_format = format;
          if (format === "series" && properties.current_episode === undefined) properties.current_episode = 0;
          if (format === "movie" && properties.current_minutes === undefined) properties.current_minutes = 0;
        });
        new obsidian.Notice(`已归类为${TYPE_LABELS[typeId]}，并按${format === "series" ? "集数" : "时长"}记录`);
        session.cancel();
      } catch (error) {
        console.error(`无法将新作品归类为${TYPE_LABELS[typeId]}`, error);
        session.cancel();
      } finally {
        session.pendingFiles--;
        if (session.handleSettled && session.pendingFiles === 0) session.cancel();
      }
    };

    // No vault-wide create listener exists until the user actually chooses
    // a Douban result. A cancelled search therefore cannot claim another work.
    session.eventRef = app.vault.on("create", file => {
      if (file.extension !== "md" || !file.path.startsWith(WORK_FOLDER)) return;
      session.pendingFiles++;
      void checkFile(file);
    });

    try {
      const result = originalHandle.call(this, item, context);
      Promise.resolve(result).then(() => {
        session.handleSettled = true;
        if (session.pendingFiles === 0) session.cancel();
      }, error => {
        console.error(`豆瓣导入${TYPE_LABELS[typeId]}失败`, error);
        session.cancel();
      });
      return result;
    } catch (error) {
      session.cancel();
      throw error;
    }
  };

  sessions.set(vaultName, session);
  plugin.getDoubanTextForCreateNewNoteForType = watchedOpen;
  handler.handle = watchedHandle;
  session.timeoutId = window.setTimeout(() => session.cancel(), SESSION_TIMEOUT);
  let launched = false;
  try {
    launched = app.commands.executeCommandById(DOUBAN_COMMAND);
  } catch (error) {
    console.error("无法打开豆瓣影视搜索", error);
  }
  if (!launched || !session.context) {
    session.cancel();
    new obsidian.Notice("无法打开豆瓣影视搜索，请确认豆瓣插件已启用");
  }
};

module.exports = {
  variety: params => importAs(params, "variety"),
  documentary: params => importAs(params, "documentary")
};
