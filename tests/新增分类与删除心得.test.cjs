const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function fixture() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(read('媒体库/视图/领域/view.js'), context);
  vm.runInContext(read('媒体库/视图/删除/view.js'), context);
  const files = new Map();
  const trashed = [];
  let failPath = '';
  const add = (filePath, fm, body = '原始正文') => {
    const file = { path: filePath, extension: filePath.split('.').pop(), basename: path.basename(filePath, '.md'), fm, body };
    files.set(file.path, file);
    return file;
  };
  const app = {
    vault: {
      getName: () => 'fixture',
      getAbstractFileByPath: name => files.get(name),
      getMarkdownFiles: () => [...files.values()].filter(file => file.extension === 'md'),
      read: async file => JSON.stringify({ fm: file.fm, body: file.body }),
      create: async (name, text) => { const data = JSON.parse(text); return add(name, data.fm, data.body); },
      trash: async (file, system) => {
        assert.equal(system, false, 'must use the vault trash, not permanent deletion');
        if (file.path === failPath) { failPath = ''; throw new Error('injected trash failure'); }
        trashed.push(file.path);
        files.delete(file.path);
      }
    },
    metadataCache: {
      getFileCache: file => ({ frontmatter: file.fm }),
      getFirstLinkpathDest: value => {
        const normalized = value.replace(/\.md$/, '');
        return files.get(normalized + '.md') || [...files.values()].find(file => file.basename === normalized) || null;
      }
    },
    fileManager: { processFrontMatter: async (file, callback) => { callback(file.fm); } }
  };
  return { app, add, files, trashed, domain: context.window.__mediaLibraryDomain,
    deletion: context.window.__mediaLibraryDeletion, failTrash: value => { failPath = value; } };
}

test('music and short drama use their own progress formats and import entries', async () => {
  const f = fixture();
  assert.equal(f.domain.formatFor({ media_type: 'music' }), 'music');
  assert.equal(f.domain.formatFor({ media_type: 'short_drama' }), 'series');
  assert.equal(f.domain.progressConfigs.music.fixedTotal, 100);
  const config = JSON.parse(read('.obsidian/plugins/quickadd/data.json'));
  const music = config.choices[0].choices.find(item => item.name === '音乐');
  const drama = config.choices[0].choices.find(item => item.name === '短剧');
  assert.equal(music.choices[0].macro.commands[0].name, '豆瓣分类导入::music');
  assert.equal(drama.choices[0].macro.commands[0].name, '豆瓣分类导入::short_drama');
  for (const item of [music, drama]) {
    const template = read(item.choices[1].templatePath);
    assert(template.includes(`media_type: ${item === music ? 'music' : 'short_drama'}`));
  }
  assert.equal(JSON.parse(read('媒体库/配置/豆瓣导入.json')).settings.musicTemplateFile,
    '媒体库/模板/豆瓣/豆瓣导入音乐.md');
});

test('old type preferences acquire the two new optional types without changing enabled types', async () => {
  const file = { path: '媒体库/配置/作品类型.json' };
  const ctx = { window: {}, document: {}, dv: { view: async () => {} }, app: { vault: {
    getName: () => 'types', getAbstractFileByPath: () => file,
    read: async () => JSON.stringify({ enabled: ['book', 'movie'], order: ['movie', 'book'] })
  } } };
  vm.createContext(ctx);
  await vm.runInContext(`(async () => { ${read('媒体库/视图/类型/view.js')} })()`, ctx);
  const controller = ctx.window.__mediaLibraryTypeControllers.get('types');
  assert.equal(controller.getTypes().length, 9);
  assert.equal(controller.getType('music').label, '音乐');
  assert.equal(controller.getType('short_drama').format, 'series');
  assert.deepEqual(Array.from(controller.getTypes({ includeDisabled: false }), type => type.id), ['movie', 'book']);
});

test('music search matches performer, album type and medium', () => {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(read('媒体库/视图/查询/view.js'), ctx);
  const query = ctx.window.__mediaLibraryQuery;
  const [entry] = query.createIndex([{ title: '夜航', media_type: 'music', artists: ['示例歌手'], album_type: 'EP', medium: '黑胶', file: { path: '媒体库/作品/夜航.md', name: '夜航' } }], []);
  assert(query.matches(entry, '示例歌手 EP 黑胶'));
});

test('planning a delete never writes or trashes anything', () => {
  const f = fixture();
  const work = f.add('媒体库/作品/A.md', { note_type: 'media' });
  f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', work: '[[媒体库/作品/A|A]]' });
  const result = f.deletion.plan(f.app, work.path);
  assert.equal(result.records.length, 1);
  assert.equal(f.trashed.length, 0);
  assert.equal(f.files.size, 2);
  assert.throws(() => f.deletion.plan(f.app, 'README.md'), /只能删除/);
});

test('deleting a series unlinks it but keeps members, records, other relations and images', async () => {
  const f = fixture();
  const series = f.add('媒体库/合集/系列A.md', { note_type: 'media_collection', collection_kind: 'series' });
  const work = f.add('媒体库/作品/A.md', { note_type: 'media', series: '[[媒体库/合集/系列A]]', collections: ['[[其他合集]]'] });
  const record = f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', work: '[[媒体库/作品/A]]', reflection: '第一次的心得' });
  const image = f.add('媒体库/合集/封面/A.jpg', {});
  await f.deletion.execute(f.app, series.path);
  assert.equal(work.fm.series, '');
  assert.deepEqual(work.fm.collections, ['[[其他合集]]']);
  assert(f.files.has(work.path)); assert(f.files.has(record.path)); assert(f.files.has(image.path));
  assert.deepEqual(f.trashed, [series.path]);
});

test('deleting a collection removes direct and inherited links but keeps all works', async () => {
  const f = fixture();
  const group = f.add('媒体库/合集/C.md', { note_type: 'media_collection', collection_kind: 'collection' });
  const series = f.add('媒体库/合集/S.md', { note_type: 'media_collection', collection_kind: 'series', collections: ['[[媒体库/合集/C]]'] });
  const work = f.add('媒体库/作品/A.md', { note_type: 'media', series: '[[媒体库/合集/S]]', collections: ['[[媒体库/合集/C]]'] });
  await f.deletion.execute(f.app, group.path);
  assert.deepEqual(Array.from(series.fm.collections), []);
  assert.deepEqual(Array.from(work.fm.collections), []);
  assert.equal(work.fm.series, '[[媒体库/合集/S]]');
  assert(f.files.has(series.path)); assert(f.files.has(work.path));
});

test('work deletion can keep records and always keeps images', async () => {
  const f = fixture();
  const work = f.add('媒体库/作品/A.md', { note_type: 'media' });
  const other = f.add('媒体库/作品/B.md', { note_type: 'media', related: ['[[媒体库/作品/A]]', '[[其他作品]]'] });
  const record = f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', work: '[[媒体库/作品/A]]', reflection: '保留的心得' });
  const image = f.add('媒体库/作品/封面/A.jpg', {});
  await f.deletion.execute(f.app, work.path, { deleteRecords: false });
  assert(f.files.has(record.path)); assert(f.files.has(image.path));
  assert.deepEqual(Array.from(other.fm.related), ['[[其他作品]]']);
});

test('a failed multi-file trash restores earlier records, their bodies and relations', async () => {
  const f = fixture();
  const work = f.add('媒体库/作品/A.md', { note_type: 'media' });
  const other = f.add('媒体库/作品/B.md', { note_type: 'media', related: ['[[媒体库/作品/A]]'] });
  const record = f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', work: '[[媒体库/作品/A]]', reflection: '不能丢' }, '手写正文');
  f.failTrash(work.path);
  await assert.rejects(f.deletion.execute(f.app, work.path), /injected trash failure/);
  assert(f.files.has(work.path));
  assert.equal(f.files.get(record.path).fm.reflection, '不能丢');
  assert.equal(f.files.get(record.path).body, '手写正文');
  assert.deepEqual(Array.from(other.fm.related), ['[[媒体库/作品/A]]']);
});

test('newly created experience records require a fresh delete confirmation', async () => {
  const f = fixture();
  const work = f.add('媒体库/作品/A.md', { note_type: 'media' });
  f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', work: '[[媒体库/作品/A]]' });
  await assert.rejects(f.deletion.execute(f.app, work.path, { expectedRecords: [] }), /关联的体验记录已变化/);
  assert.equal(f.trashed.length, 0);
});

test('reflections belong to separate experience files and do not change dates, score or body', async () => {
  const f = fixture();
  const first = f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', experience_rating: 4, ended_at: '2025-01-01' }, '用户正文');
  const second = f.add('媒体库/记录/A-2.md', { note_type: 'media_experience', experience_rating: 5 });
  await f.domain.saveReflection(f.app, first, '第一次的理解', '');
  await f.domain.saveReflection(f.app, second, '第二次发现了新东西', '');
  assert.equal(first.fm.reflection, '第一次的理解'); assert.equal(second.fm.reflection, '第二次发现了新东西');
  assert.equal(first.fm.experience_rating, 4); assert.equal(first.fm.ended_at, '2025-01-01'); assert.equal(first.body, '用户正文');
  await assert.rejects(f.domain.saveReflection(f.app, first, '旧窗口覆盖', ''), /其他窗口修改/);
  assert.equal(first.fm.reflection, '第一次的理解');
  await f.domain.saveReflection(f.app, first, '', '第一次的理解');
  assert.equal(first.fm.reflection, '');
});

function reflectionEditor(f, record) {
  const nodes = [];
  const node = (tag = 'div', options = {}) => {
    const element = { tag, options, children: [], events: {},
      createEl(tag, options) { const child = node(tag, options); this.children.push(child); return child; },
      createDiv(options) { return this.createEl('div', options); },
      empty() { this.children = []; }, setText(text) { this.text = text; },
      classList: { toggle() {} },
      addEventListener(name, callback) { this.events[name] = callback; }
    };
    nodes.push(element);
    return element;
  };
  const modal = node();
  const state = { cancelled: 0, saved: 0, notices: [] };
  const ctx = { app: f.app, console,
    window: { __mediaLibraryDomain: f.domain, __mediaLibraryObsidian: {
      Notice: class { constructor(message) { state.notices.push(message); } }
    } },
    dv: { container: { createDiv() { throw new Error('must render inside the modal'); } },
      current() { throw new Error('must use the selected record, not the work page'); } },
    input: { container: modal, getPath: () => record.path, initialValue: record.fm.reflection || '',
      startEditing: true, hideHeading: true,
      onCancel: () => state.cancelled++, onSaved: () => state.saved++ }
  };
  vm.createContext(ctx);
  vm.runInContext(read('媒体库/视图/心得/view.js'), ctx);
  const latest = predicate => nodes.filter(predicate).at(-1);
  return { state, input(text) {
    const editor = latest(item => item.tag === 'textarea'); editor.value = text; editor.events.input();
  }, click: text => latest(item => item.tag === 'button' && item.options.text === text).events.click(),
  draft: () => latest(item => item.tag === 'textarea').value };
}

test('work-page reflection shortcut edits only its selected record through the shared editor', async () => {
  const f = fixture();
  const work = f.add('媒体库/作品/A.md', { note_type: 'media', title: 'A' });
  const first = f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', reflection: '第一次' });
  const second = f.add('媒体库/记录/A-2.md', { note_type: 'media_experience', reflection: '第二次' });
  const editor = reflectionEditor(f, first);
  assert.equal(editor.draft(), '第一次');
  editor.input('第一次的新心得\n支持多行');
  await editor.click('保存心得');
  assert.equal(first.fm.reflection, '第一次的新心得\n支持多行');
  assert.equal(second.fm.reflection, '第二次');
  assert.equal(work.fm.reflection, undefined);
  assert.equal(editor.state.saved, 1);
});

test('cancelling a shortcut does not save and concurrent edits retain the draft on failure', async () => {
  const f = fixture();
  const record = f.add('媒体库/记录/A-1.md', { note_type: 'media_experience', reflection: '原心得' });
  const cancelled = reflectionEditor(f, record);
  cancelled.input('不保存');
  cancelled.click('取消');
  assert.equal(record.fm.reflection, '原心得');
  assert.equal(cancelled.state.cancelled, 1);
  const editor = reflectionEditor(f, record);
  editor.input('当前草稿');
  record.fm.reflection = '另一个窗口修改了心得';
  await editor.click('保存心得');
  assert.equal(record.fm.reflection, '另一个窗口修改了心得');
  assert.equal(editor.draft(), '当前草稿');
  assert.equal(editor.state.saved, 0);
  assert.match(editor.state.notices.at(-1), /其他窗口修改/);
});
