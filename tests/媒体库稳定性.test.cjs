const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const hero = fs.readFileSync(path.join(root, '媒体库/视图/作品头图/view.js'), 'utf8');
const collectionSource = fs.readFileSync(path.join(root, '媒体库/视图/合集页/view.js'), 'utf8');
const recordView = fs.readFileSync(path.join(root, '媒体库/视图/体验记录/view.js'), 'utf8');
const domainSource = fs.readFileSync(path.join(root, '媒体库/视图/领域/view.js'), 'utf8');
const querySource = fs.readFileSync(path.join(root, '媒体库/视图/查询/view.js'), 'utf8');
const typeSource = fs.readFileSync(path.join(root, '媒体库/视图/类型/view.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, '媒体库/视图/导入适配/view.js'), 'utf8');
const healthSource = fs.readFileSync(path.join(root, '媒体库/视图/健康规则/view.js'), 'utf8');

function loadHealth() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(healthSource, context);
  return context.window.__mediaLibraryHealth;
}

function loadDomain() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(domainSource, context);
  return context.window.__mediaLibraryDomain;
}

function declaration(source, name) {
  const start = source.indexOf(`const ${name} =`);
  assert(start >= 0, `missing ${name}`);
  const lineEnd = source.indexOf('\n', start);
  if (source.slice(start, lineEnd).trimEnd().endsWith(';')) return source.slice(start, lineEnd);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const terminator = `\n${indent}};`;
  const end = source.indexOf(terminator, start);
  assert(end >= 0, `unterminated ${name}`);
  return source.slice(start, end + terminator.length);
}

function fixture(work, initialRecord) {
  const files = new Map();
  let failCreate = false;
  const context = {
    console,
    page: { media_type: 'movie', title: 'Fixture', file: { path: '媒体库/作品/Fixture.md', name: 'Fixture' } },
    workFormat: 'movie',
    liveExperienceIndex: 1,
    liveFinishedAt: '',
    localToday: () => '2026-09-23',
    writeFrontmatter: async fn => fn(work),
    domain: loadDomain(),
    findExperienceFile: index => [...files.values()].find(file => file.fm.experience_index === index),
    experienceFrontmatter: file => file.fm,
    ensureFolder: async () => {},
    experienceLabels: { movie: { noun: '观看' } },
    app: {
      vault: {
        getName: () => 'fixture',
        getAbstractFileByPath: target => files.get(target),
        create: async (target, body) => {
          if (failCreate) {
            failCreate = false;
            throw Error('injected create failure');
          }
          const file = { path: target, body, fm: {} };
          files.set(target, file);
          return file;
        }
      },
      fileManager: { processFrontMatter: async (file, fn) => fn(file.fm) }
    }
  };
  if (initialRecord) {
    const file = {
      path: '媒体库/记录/2025/Fixture · 第1次.md',
      body: 'User-authored experience notes',
      fm: { experience_index: 1, result: 'completed', ...initialRecord }
    };
    files.set(file.path, file);
  }
  vm.createContext(context);
  const names = [
    'dateText', 'numberFrom', 'progressConfigs', 'experienceIndexFrom',
    'yamlText', 'historyProgress', 'createExperienceContent',
    'upsertExperienceSnapshot', 'finalizeExperience', 'syncEndedSnapshot',
    'withdrawExperienceSnapshot'
  ];
  vm.runInContext(names.map(name => declaration(hero, name)).join('\n')
    + '\nObject.assign(globalThis, { finalizeExperience, syncEndedSnapshot, withdrawExperienceSnapshot });', context);
  return { context, files, failNextCreate: () => { failCreate = true; } };
}

test('all changed views compile as async Dataview scripts', () => {
  for (const source of [hero, recordView, domainSource, querySource, typeSource, adapterSource, healthSource,
    fs.readFileSync(path.join(root, '媒体库/视图/主题/view.js'), 'utf8'),
    fs.readFileSync(path.join(root, '媒体库/视图/作品关系/view.js'), 'utf8'),
    fs.readFileSync(path.join(root, '媒体库/视图/搜索/view.js'), 'utf8'),
    fs.readFileSync(path.join(root, '媒体库/视图/类别页/view.js'), 'utf8'),
    fs.readFileSync(path.join(root, '媒体库/视图/回顾/view.js'), 'utf8')]) {
    assert.doesNotThrow(() => new vm.Script(`(async () => {\n${source}\n})`));
  }
  const home = fs.readFileSync(path.join(root, '媒体库/首页.md'), 'utf8');
  const script = home.match(/```dataviewjs\n([\s\S]*?)\n```/)?.[1];
  assert(script, 'missing home Dataview script');
  assert.doesNotThrow(() => new vm.Script(`(async () => {\n${script}\n})`));
});

test('health checks report broken history and ambiguous source IDs without changing notes', () => {
  const work = {
    file: { path: '媒体库/作品/A.md', name: 'A' }, title: 'A', status: '已完成',
    experience_index: 2, source_id: 'same', progress_minute: 18, current_minutes: 20
  };
  const other = {
    file: { path: '媒体库/作品/B.md', name: 'B' }, title: 'B', status: '进行中', source_id: 'same'
  };
  const record = {
    file: { path: '媒体库/记录/A-2.md', name: 'A-2' }, work: '[[媒体库/作品/A|A]]',
    experience_index: 2, record_state: 'reopened', date_certainty: 'exact',
    started_at: '2026-02-02', ended_at: '2026-01-01', verified_year: 2025, year_verified: true
  };
  const orphan = { file: { path: '媒体库/记录/Lost.md', name: 'Lost' }, work: '[[媒体库/作品/Missing]]' };
  const before = JSON.stringify([work, other, record, orphan]);
  const codes = loadHealth().inspect([work, other], [record, { ...record, file: { path: '媒体库/记录/A-2-copy.md', name: 'A-2-copy' } }, orphan])
    .map(issue => issue.code);
  for (const code of ['orphan-record', 'duplicate-experience', 'date-order', 'year-conflict',
    'reopened-ended', 'missing-snapshot', 'shadow-progress', 'duplicate-source']) {
    assert(codes.includes(code), `health check missing ${code}`);
  }
  assert.equal(JSON.stringify([work, other, record, orphan]), before);
});

test('record edits map value and total to the work format only when units agree', () => {
  const start = recordView.indexOf('    const progressConfig = domain.progressConfigs[work.mediaFormat];');
  const end = recordView.indexOf('\n\n', start);
  assert(start >= 0 && end > start);
  const snippet = recordView.slice(start, end);
  const matching = { domain: loadDomain(), work: { mediaFormat: 'movie' }, workUpdates: {}, updates: { progress_value: 80, progress_total: 156, progress_unit: 'minute' } };
  vm.createContext(matching);
  vm.runInContext(snippet, matching);
  assert.equal(matching.workUpdates.current_minutes, 80);
  assert.equal(matching.workUpdates.runtime_minutes, 156);
  assert.equal(matching.workUpdates.progress_minute, undefined);
  const mismatch = { domain: loadDomain(), work: { mediaFormat: 'movie' }, workUpdates: {}, updates: { progress_value: 80, progress_total: 12, progress_unit: 'episode' } };
  vm.createContext(mismatch);
  vm.runInContext(snippet, mismatch);
  assert.deepEqual(Object.keys(mismatch.workUpdates), []);
});

test('record format fallback covers seven media types', () => {
  const domain = loadDomain();
  const expected = {
    book: 'book', movie: 'movie', tv: 'series', anime: 'series',
    game: 'game', variety: 'series', documentary: 'movie'
  };
  for (const [media_type, format] of Object.entries(expected)) {
    assert.equal(domain.formatFor({ media_type }), format);
  }
  assert.equal(domain.formatFor({ media_type: 'documentary', media_format: 'series' }), 'series');
});

test('writes to one file are serialized across callers', async () => {
  const domain = loadDomain();
  const order = [];
  let release;
  const first = domain.runFileWrite('vault', 'work.md', async () => {
    order.push('first-start');
    await new Promise(resolve => { release = resolve; });
    order.push('first-end');
  });
  const second = domain.runFileWrite('vault', 'work.md', async () => { order.push('second'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first-start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('category and full search share aliases, people, inherited collections and multiword matching', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(querySource, context);
  const query = context.window.__mediaLibraryQuery;
  const page = {
    title: '星际邮差', aliases: ['宇宙信使'], cast: ['阿南'], media_type: 'movie',
    series: '[[媒体库/合集/星际系列]]', file: { path: '媒体库/作品/星际邮差.md', name: '星际邮差' }
  };
  const groups = [
    { title: '星际系列', collection_kind: 'series', collections: ['[[媒体库/合集/宇宙漫游]]'], file: { path: '媒体库/合集/星际系列.md', name: '星际系列' } },
    { title: '宇宙漫游', collection_kind: 'collection', file: { path: '媒体库/合集/宇宙漫游.md', name: '宇宙漫游' } }
  ];
  const [entry] = query.createIndex([page], groups, { movie: { label: '电影' } });
  assert.equal(query.matches(entry, '宇宙信使 阿南 宇宙漫游'), true);
  assert.equal(query.matches(entry, '宇宙信使 不存在'), false);
});

test('disabled types with existing works remain browsable', async () => {
  const saved = { version: 1, enabled: ['book'], order: ['book', 'tv', 'movie', 'anime', 'game', 'variety', 'documentary'] };
  const context = {
    window: {}, console,
    dv: { view: async () => {} },
    app: { vault: {
      getName: () => 'fixture',
      getAbstractFileByPath: () => ({ path: '媒体库/配置/作品类型.json' }),
      read: async () => JSON.stringify(saved)
    } }
  };
  vm.createContext(context);
  await vm.runInContext(`(async () => { ${typeSource} })()`, context);
  const controller = context.window.__mediaLibraryTypeControllers.get('fixture');
  assert.deepEqual(Array.from(controller.getBrowsableTypes([{ media_type: 'documentary' }]), type => type.id), ['book', 'documentary']);
});

test('QuickAdd adapter registers a missing command without restarting the plugin', async () => {
  let registered = false;
  let restarted = false;
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(adapterSource, context);
  const app = {
    plugins: {
      plugins: { quickadd: {
        getChoiceById: () => ({ id: 'choice' }),
        addCommandForChoice: () => { registered = true; }
      } },
      disablePlugin: async () => { restarted = true; },
      enablePlugin: async () => { restarted = true; }
    },
    commands: {
      findCommand: () => registered,
      executeCommandById: () => true
    }
  };
  assert.equal(await context.window.__mediaLibraryImportAdapter.launch(app,
    { quickAddChoiceId: 'choice', label: '图书' }, []), true);
  assert.equal(registered, true);
  assert.equal(restarted, false);
});

test('mobile add menu chooses a QuickAdd child without opening its search prompt', async () => {
  const buttons = [];
  const makeElement = () => ({
    addClass: () => {}, setText: () => {}, empty: () => {},
    createDiv: () => makeElement(), createSpan: () => makeElement(),
    createEl: (tag, options) => {
      const element = makeElement();
      element.label = options?.attr?.['aria-label'];
      if (tag === 'button') buttons.push(element);
      return element;
    },
    addEventListener: function (event, callback) { if (event === 'click') this.click = callback; }
  });
  class Modal {
    constructor() { this.modalEl = makeElement(); this.titleEl = makeElement(); this.contentEl = makeElement(); }
    open() { this.onOpen(); }
    close() { this.onClose(); }
  }
  const chosen = [];
  let openedPrompt = false;
  const quickAdd = {
    getChoiceById: () => ({ choices: [
      { name: '豆瓣导入图书', type: 'Macro', icon: 'download' },
      { name: '手动新增图书', type: 'Template', icon: 'pencil-line' }
    ] }),
    api: { executeChoice: async name => { chosen.push(name); } }
  };
  const context = { window: { setTimeout: fn => fn() }, console,
    require: () => ({ Modal, setIcon: () => {}, Notice: class {} }) };
  vm.createContext(context);
  vm.runInContext(adapterSource, context);
  const app = {
    isMobile: true,
    plugins: { plugins: { quickadd: quickAdd } },
    commands: { executeCommandById: () => { openedPrompt = true; } }
  };
  assert.equal(await context.window.__mediaLibraryImportAdapter.launch(app,
    { quickAddChoiceId: 'book', label: '图书', id: 'book' }, []), true);
  assert.equal(buttons.length, 2);
  buttons.find(button => button.label === '手动新增图书').click();
  await Promise.resolve();
  assert.deepEqual(chosen, ['手动新增图书']);
  assert.equal(openedPrompt, false);

  buttons.length = 0;
  const existingModal = new Modal();
  let closed = false;
  let wentBack = false;
  existingModal.close = () => { closed = true; existingModal.onClose?.(); };
  assert.equal(await context.window.__mediaLibraryImportAdapter.launch(app,
    { quickAddChoiceId: 'book', label: '图书', id: 'book' }, [],
    { modal: existingModal, onBack: () => { wentBack = true; } }), true);
  assert.equal(closed, false, 'choosing a category should keep the current modal open');
  assert.equal(buttons.length, 3);
  buttons[0].click();
  assert.equal(wentBack, true);
  buttons.find(button => button.label === '豆瓣导入图书').click();
  await Promise.resolve();
  assert.equal(closed, true);
  assert.deepEqual(chosen, ['手动新增图书', '豆瓣导入图书']);
  assert.equal(openedPrompt, false);
});

test('home mobile category choice keeps its modal open while showing methods', async () => {
  const buttons = [];
  const makeElement = () => ({
    addClass: () => {}, setText: () => {}, empty: () => {},
    createDiv: () => makeElement(), createSpan: () => makeElement(),
    createEl: (tag, options) => {
      const element = makeElement();
      element.label = options?.attr?.['aria-label'];
      if (tag === 'button') buttons.push(element);
      return element;
    },
    addEventListener: function (event, callback) { if (event === 'click') this.click = callback; }
  });
  let modal;
  class Modal {
    constructor() { this.modalEl = makeElement(); this.titleEl = makeElement(); this.contentEl = makeElement(); this.closed = false; modal = this; }
    open() { this.onOpen(); }
    close() { this.closed = true; this.onClose(); }
  }
  let selected;
  const context = {
    obsidianModalClass: () => Modal,
    typeController: {
      getTypes: () => [{ id: 'book', label: '图书', icon: 'book-open', subtitle: '图书。' }],
      launch: async (id, options) => { selected = { id, options }; return true; }
    },
    app: { isMobile: true }, document: { body: { classList: { contains: () => true } } },
    window: { setTimeout: fn => fn() }, setAppIcon: () => {}, showProgressNotice: () => {}, console
  };
  vm.createContext(context);
  const home = fs.readFileSync(path.join(root, '媒体库/首页.md'), 'utf8');
  vm.runInContext(declaration(home, 'openTypePicker') + '\nglobalThis.openTypePicker = openTypePicker;', context);
  context.openTypePicker();
  buttons.find(button => button.label === '新增图书').click();
  await Promise.resolve();
  assert.equal(modal.closed, false);
  assert.equal(selected.id, 'book');
  assert.equal(selected.options.modal, modal);
});

test('collection creation stays outside media types and opens the existing QuickAdd template', async () => {
  const home = fs.readFileSync(path.join(root, '媒体库/首页.md'), 'utf8');
  const quickAddConfig = JSON.parse(fs.readFileSync(path.join(root, '.obsidian/plugins/quickadd/data.json'), 'utf8'));
  const collectionChoice = quickAddConfig.choices[0].choices.find(choice => choice.id === '5c24e729-3af9-4686-b593-64b1f824ab7e');
  assert.equal(collectionChoice?.templatePath, '媒体库/模板/手动/合集.md');
  assert(home.indexOf('const collectionSection = shell.createDiv({ cls: "media-type-collection-section" })')
    > home.indexOf('const grid = shell.createDiv({ cls: "media-type-picker-grid" })'));
  const chosen = [];
  const notices = [];
  let closed = false;
  const quickAdd = {
    getChoiceById: id => id === collectionChoice.id ? collectionChoice : null,
    api: { executeChoice: async name => { chosen.push(name); } }
  };
  const context = {
    app: { plugins: { plugins: { quickadd: quickAdd } } },
    window: { setTimeout: fn => fn() },
    watchCollectionForm: () => () => {},
    showProgressNotice: message => notices.push(message),
    console: { error: () => {} }
  };
  vm.createContext(context);
  vm.runInContext(declaration(home, 'openCollectionCreator')
    + '\nglobalThis.openCollectionCreator = openCollectionCreator;', context);
  assert.equal(context.openCollectionCreator({ close: () => { closed = true; } }), true);
  await Promise.resolve();
  assert.equal(closed, true);
  assert.deepEqual(chosen, ['新建合集']);
  assert.deepEqual(notices, []);

  quickAdd.api.executeChoice = async () => { throw Object.assign(new Error('Input cancelled by user'), { name: 'MacroAbortError' }); };
  assert.equal(context.openCollectionCreator({ close: () => {} }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(notices, [], 'canceling the form must not show a configuration error');

  quickAdd.api.executeChoice = async () => { throw new Error('actual failure'); };
  assert.equal(context.openCollectionCreator({ close: () => {} }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notices.length, 1, 'a genuine QuickAdd failure must still be reported');

  context.app.plugins.plugins.quickadd = null;
  closed = false;
  assert.equal(context.openCollectionCreator({ close: () => { closed = true; } }), false);
  assert.equal(closed, false);
  assert.equal(notices.length, 2);
});

test('type picker uses compact names only and keeps collection separate', () => {
  const home = fs.readFileSync(path.join(root, '媒体库/首页.md'), 'utf8');
  const css = fs.readFileSync(path.join(root, '.obsidian/snippets/media-library.css'), 'utf8');
  const rule = selector => css.match(new RegExp(`\\${selector} \\{([^}]+)\\}`))?.[1] || '';
  assert(home.includes('const cardHeader = button.createSpan({ cls: "media-type-picker-head" })'));
  assert.doesNotMatch(home, /cls: "media-type-picker-description"/);
  assert(home.includes('collectionCopy.createEl("strong", { text: "合集或系列" })'));
  assert.doesNotMatch(home, /collectionCopy\.createEl\("strong", \{ text: "新建合集或系列" \}\)/);
  assert.match(rule('.media-type-picker-card'), /min-height:\s*88px/);
  assert.match(rule('.media-type-collection-section'), /grid-template-columns:\s*repeat\(3,/);
  const template = fs.readFileSync(path.join(root, '媒体库/模板/手动/合集.md'), 'utf8');
  assert.match(template, /label:合集类型/);
});

test('collection QuickAdd form is localized without affecting other forms', () => {
  const home = fs.readFileSync(path.join(root, '媒体库/首页.md'), 'utf8');
  const fields = [{ textContent: '合集名称' }, { textContent: 'series,collection' }];
  const title = { textContent: 'Provide inputs' };
  const buttons = [{ textContent: 'Submit' }, { textContent: 'Cancel' }];
  const close = { setAttribute(name, value) { this[name] = value; } };
  const form = { querySelectorAll(selector) { return selector === '.setting-item-name' ? fields : buttons; }, querySelector(selector) { return selector === '.qa-onepage-title' ? title : close; } };
  const context = {
    document: { body: {}, querySelectorAll: () => [form] },
    MutationObserver: class { observe() {} disconnect() {} },
    window: { setTimeout: () => 1, clearTimeout: () => {} }
  };
  vm.createContext(context);
  vm.runInContext(declaration(home, 'watchCollectionForm') + '\nglobalThis.watchCollectionForm = watchCollectionForm;', context);
  context.watchCollectionForm();
  assert.equal(title.textContent, '新建合集或系列');
  assert.equal(fields[1].textContent, '合集类型');
  assert.deepEqual(buttons.map(button => button.textContent), ['创建', '取消']);
  assert.equal(close['aria-label'], '关闭');
});

test('collection cover and backdrop pickers use Chinese labels and file names', () => {
  const title = { textContent: '' };
  const search = { setAttribute(name, value) { this[name] = value; } };
  const close = { classList: { add() {} }, setAttribute(name, value) { this[name] = value; }, removeAttribute() {} };
  const image = { getAttribute: () => '媒体库/合集/封面/示例合集.jpg' };
  const label = { textContent: '媒体库/合集/封面/示例合集.jpg' };
  const card = {
    querySelector(selector) { return selector === '.mb-image-card-image' ? image : label; },
    getAttribute() { return ''; },
    setAttribute(name, value) { this[name] = value; }
  };
  const buttons = [{ textContent: 'Select none', setAttribute(name, value) { this[name] = value; } }, { textContent: 'Cancel', setAttribute(name, value) { this[name] = value; } }];
  const picker = {
    querySelector(selector) { return selector.startsWith('.modal-title') ? title : selector.startsWith('.mb-image-modal-header') ? search : close; },
    querySelectorAll(selector) { return selector === '.mb-image-card' ? [card] : buttons; }
  };
  const context = {
    document: { querySelector: () => picker },
    MutationObserver: class { observe() {} }
  };
  vm.createContext(context);
  vm.runInContext(declaration(collectionSource, 'localizeCollectionImagePicker') + '\nglobalThis.localizeCollectionImagePicker = localizeCollectionImagePicker;', context);
  assert.equal(context.localizeCollectionImagePicker('封面'), true);
  assert.equal(title.textContent, '选择封面');
  assert.equal(search.placeholder, '搜索封面图片…');
  assert.equal(label.textContent, '示例合集');
  assert.equal(card['aria-label'], '选择 示例合集');
  assert.deepEqual(buttons.map(button => button.textContent), ['不使用封面', '取消']);
  assert.equal(close['aria-label'], '关闭');

  title.textContent = '';
  buttons[0].textContent = 'Select none';
  assert.equal(context.localizeCollectionImagePicker('横幅'), true);
  assert.equal(title.textContent, '选择横幅');
  assert.equal(search.placeholder, '搜索横幅图片…');
  assert.equal(buttons[0].textContent, '不使用横幅');
});

test('rating and progress synchronization preserve a confirmed year', async () => {
  const { context, files } = fixture(
    { status: '已完成', experience_index: 1, current_minutes: 100, runtime_minutes: 100, finished_at: '2025-02-03', rating: 4 },
    { record_origin: 'tracked', date_certainty: 'approximate', year_verified: true, verified_year: 2024, ended_at: '2025-02-03' }
  );
  await context.syncEndedSnapshot();
  const saved = [...files.values()][0].fm;
  assert.equal(saved.date_certainty, 'approximate');
  assert.equal(saved.verified_year, 2024);
  assert.equal(saved.year_verified, true);
});

test('clearing the work finish date marks the current record date unknown', async () => {
  const { context, files } = fixture(
    { status: '已完成', experience_index: 1, current_minutes: 100, runtime_minutes: 100, finished_at: null },
    { record_origin: 'tracked', date_certainty: 'exact', year_verified: true, verified_year: 2025, ended_at: '2025-02-03' }
  );
  await context.syncEndedSnapshot({ dateChange: 'finished_at' });
  const saved = [...files.values()][0].fm;
  assert.equal(saved.ended_at, null);
  assert.equal(saved.date_certainty, 'unknown');
  assert.equal(saved.year_verified, false);
  assert.equal(saved.verified_year, null);
});

test('changing the start date does not restore an untrusted finish date', async () => {
  const { context, files } = fixture(
    { status: '已完成', experience_index: 1, current_minutes: 100, runtime_minutes: 100, started_at: '2024-12-01', finished_at: '2025-02-03' },
    { record_origin: 'tracked', date_certainty: 'approximate', year_verified: true, verified_year: 2024, ended_at: null }
  );
  await context.syncEndedSnapshot({ dateChange: 'started_at' });
  const saved = [...files.values()][0].fm;
  assert.equal(saved.started_at, '2024-12-01');
  assert.equal(saved.ended_at, null);
  assert.equal(saved.verified_year, 2024);
});

test('failed legacy archive retries without promoting migrated dates', async () => {
  const work = { status: '已完成', current_minutes: 100, runtime_minutes: 100, finished_at: '2020-01-02' };
  const { context, files, failNextCreate } = fixture(work);
  failNextCreate();
  await assert.rejects(context.finalizeExperience('completed'), /injected create failure/);
  assert.equal(work.current_experience_origin, 'migrated');
  await context.finalizeExperience('completed');
  const saved = [...files.values()][0].fm;
  assert.equal(saved.record_origin, 'migrated');
  assert.equal(saved.date_certainty, 'approximate');
  assert.equal(saved.year_verified, false);
});

test('reopening keeps the original Markdown body and experience-specific fields', async () => {
  const work = { status: '已完成', experience_index: 1, current_minutes: 100, runtime_minutes: 100, finished_at: '2025-02-03' };
  const { context, files } = fixture(work, {
    record_origin: 'tracked', edition: 'Director cut', played_on: ['Example platform'], ended_at: '2025-02-03'
  });
  await context.withdrawExperienceSnapshot(1);
  const saved = [...files.values()][0];
  assert.equal(saved.fm.record_state, 'reopened');
  assert.match(saved.body, /User-authored experience notes/);
  work.status = '已完成';
  work.finished_at = '2026-09-23';
  await context.finalizeExperience('completed', { index: 1, status: true });
  assert.equal(saved.fm.record_state, 'ended');
  assert.equal(saved.fm.edition, 'Director cut');
  assert.deepEqual(saved.fm.played_on, ['Example platform']);
  assert.match(saved.body, /User-authored experience notes/);
  assert.equal(files.size, 1);
});

test('archive refuses a stale status or experience index', async () => {
  const work = { status: '暂停', experience_index: 2, current_minutes: 100, runtime_minutes: 100 };
  const { context, files } = fixture(work);
  await assert.rejects(context.finalizeExperience('completed', { index: 1, status: true }), /STALE_EXPERIENCE_ACTION/);
  assert.equal(work.status, '暂停');
  assert.equal(files.size, 0);
});

test('a delayed completion is cancelled after a later status choice', async () => {
  let release;
  let archived = 0;
  const context = {
    isBusy: false, pendingResult: null, statusRevision: 0,
    liveStatus: '已完成', currentIndex: 1, liveExperienceIndex: 1,
    setBusy: value => { context.isBusy = value; },
    renderHistory: () => {},
    finalizeExperience: async () => { archived += 1; },
    showNotice: () => {},
    callout: { dispatchEvent: () => {} },
    window: { setTimeout: (callback, delay) => { if (delay === 360) release = callback; } }
  };
  vm.createContext(context);
  vm.runInContext(declaration(hero, 'syncEndedExperience') + '\nglobalThis.runDelayed = syncEndedExperience;', context);
  const pending = context.runDelayed('completed');
  context.liveStatus = '暂停';
  context.statusRevision = 1;
  release();
  await pending;
  assert.equal(archived, 0);
});
