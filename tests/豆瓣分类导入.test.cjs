const assert = require("node:assert/strict");
const test = require("node:test");

global.window = globalThis;
const importer = require("../媒体库/视图/主题/豆瓣分类导入.js");

let vaultNumber = 0;
const makeApp = () => {
  const listeners = new Set();
  const frontmatter = new Map();
  const notices = [];
  let context;
  let updateCount = 0;
  const plugin = {
    getDoubanTextForCreateNewNoteForType(value) {
      context = value;
    },
    doubanExtractHandler: {
      handle(item, value) {
        if (value.file) {
          frontmatter.set(value.file, value.properties);
          for (const listener of [...listeners]) listener(value.file);
        }
        return Promise.resolve(item);
      }
    }
  };
  const name = `test-${++vaultNumber}`;
  const app = {
    plugins: { plugins: { "obsidian-douban-plugin": plugin } },
    vault: {
      getName: () => name,
      on: (_event, listener) => { listeners.add(listener); return listener; },
      offref: listener => listeners.delete(listener)
    },
    metadataCache: { getFileCache: file => ({ frontmatter: frontmatter.get(file) }) },
    fileManager: {
      async processFrontMatter(file, callback) {
        updateCount++;
        callback(frontmatter.get(file));
      }
    },
    commands: {
      executeCommandById() {
        plugin.getDoubanTextForCreateNewNoteForType({ kind: "current" }, "movie");
        return true;
      }
    }
  };
  return {
    app, plugin, frontmatter, notices,
    get context() { return context; },
    get updateCount() { return updateCount; },
    get listenerCount() { return listeners.size; },
    cancel() { window.__mediaLibraryDoubanImportSessions?.get(name)?.cancel(); },
    obsidian: { Notice: class { constructor(message) { notices.push(message); } } }
  };
};

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test("取消搜索不会监听或误归类其他豆瓣导入", async () => {
  const state = makeApp();
  const originalHandle = state.plugin.doubanExtractHandler.handle;
  importer.variety(state);
  assert.equal(state.listenerCount, 0);

  const movie = { path: "媒体库/作品/别的电影.md", extension: "md" };
  await state.plugin.doubanExtractHandler.handle({ id: "200" }, {
    kind: "another-import", file: movie,
    properties: { note_type: "media", media_type: "movie", source: "douban", source_id: "200" }
  });
  await nextTurn();
  assert.equal(state.updateCount, 0);
  assert.equal(state.frontmatter.get(movie).media_type, "movie");
  assert.equal(state.listenerCount, 0);
  state.cancel();
  assert.equal(state.plugin.doubanExtractHandler.handle, originalHandle);
});

test("仅将选中的豆瓣纪录电影归类，并保留单部形式", async () => {
  const state = makeApp();
  importer.documentary(state);
  const film = { path: "媒体库/作品/纪录电影.md", extension: "md" };
  state.context.file = film;
  state.context.properties = {
    note_type: "media", media_type: "movie", source: "douban", source_id: "300"
  };
  await state.plugin.doubanExtractHandler.handle({ id: "300" }, state.context);
  await nextTurn();
  assert.equal(state.frontmatter.get(film).media_type, "documentary");
  assert.equal(state.frontmatter.get(film).media_format, "movie");
  assert.equal(state.listenerCount, 0);
  assert.equal(state.updateCount, 1);
});

test("豆瓣 ID 不匹配时不修改新作品", async () => {
  const state = makeApp();
  importer.variety(state);
  const series = { path: "媒体库/作品/其他剧集.md", extension: "md" };
  state.context.file = series;
  state.context.properties = {
    note_type: "media", media_type: "tv", source: "douban", source_id: "999"
  };
  await state.plugin.doubanExtractHandler.handle({ id: "400" }, state.context);
  await nextTurn();
  assert.equal(state.frontmatter.get(series).media_type, "tv");
  assert.equal(state.updateCount, 0);
  assert.equal(state.listenerCount, 0);
});

test("选中的电视剧条目按剧集综艺记录", async () => {
  const state = makeApp();
  importer.variety(state);
  const series = { path: "媒体库/作品/综艺节目.md", extension: "md" };
  state.context.file = series;
  state.context.properties = {
    note_type: "media", media_type: "tv", source: "douban", source_id: "500"
  };
  await state.plugin.doubanExtractHandler.handle({ id: "500" }, state.context);
  await nextTurn();
  assert.equal(state.frontmatter.get(series).media_type, "variety");
  assert.equal(state.frontmatter.get(series).media_format, "series");
  assert.equal(state.frontmatter.get(series).current_episode, 0);
  assert.equal(state.listenerCount, 0);
});
