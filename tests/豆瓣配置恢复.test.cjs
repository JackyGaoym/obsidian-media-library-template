const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '媒体库/视图/豆瓣配置/view.js'), 'utf8');
const recipe = JSON.parse(fs.readFileSync(path.join(root, '媒体库/配置/豆瓣导入.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const configured = () => ({ ...copy(recipe.settings), arraySettings: copy(recipe.arraySettings), customProperties: copy(recipe.customProperties) });

function fixture({ settings = {}, choice = 'accept', saveError = false, hook } = {}) {
  const notices = [], modals = [], commands = [];
  const buttons = [];
  const element = (tag, options) => ({
    tag, options, children: [],
    addClass() {}, setText(text) { this.text = text; }, empty() { this.children = []; },
    createEl(tag, options) { const child = element(tag, options); this.children.push(child); if (tag === 'button') buttons.push(child); return child; },
    createDiv(options) { return this.createEl('div', options); },
    addEventListener(_name, callback) { this.click = callback; }
  });
  const plugin = { settings, saves: 0, async saveSettings() {
    this.saves++;
    if (saveError) throw new Error('injected save failure');
    this.persisted = copy(this.settings);
  } };
  const obsidian = {
    Notice: class { constructor(message) { notices.push(message); } },
    Modal: class {
      constructor() { this.modalEl = element(); this.titleEl = element(); this.contentEl = element(); modals.push(this); }
      open() {
        this.onOpen();
        hook?.(plugin);
        queueMicrotask(() => {
          if (choice === 'close') this.close();
          else if (choice !== 'pending') buttons.find(button => button.options.text === (choice === 'accept' ? '恢复并继续' : '取消')).click();
        });
      }
      close() { this.onClose(); }
    }
  };
  const files = new Map(['媒体库/配置/豆瓣导入.json', '媒体库/视图/豆瓣配置/view.js',
    ...Object.entries(recipe.settings).filter(([key]) => key.endsWith('TemplateFile')).map(([, value]) => value)]
    .map(file => [file, { path: file, extension: file.split('.').at(-1) }]));
  const app = {
    plugins: { plugins: { 'obsidian-douban-plugin': plugin } },
    vault: {
      getAbstractFileByPath: file => files.get(file),
      read: async file => file.path.endsWith('.json') ? JSON.stringify(recipe) : source
    },
    commands: { executeCommandById: command => { commands.push(command); return true; } }
  };
  const window = {};
  vm.runInNewContext(source, { window, console });
  return { app, plugin, obsidian, notices, modals, files, commands, window, buttons,
    manager: window.__mediaLibraryDoubanConfig, ensure: () => window.__mediaLibraryDoubanConfig.ensure(app, obsidian) };
}

test('correct configuration opens no prompt and never writes settings', async () => {
  const f = fixture({ settings: configured() });
  assert.equal(await f.ensure(), true);
  assert.equal(f.modals.length, 0);
  assert.equal(f.plugin.saves, 0);
});

test('reinstalled plugin restores all managed values in place, preserving auth and custom settings', async () => {
  const settings = { loginCookiesContent: 'private-cookie-fixture', loginHeadersContent: 'private-header-fixture',
    theaterTemplateFile: '自定义/戏剧.md', pictureBedFlag: true, debugMode: true,
    arraySettings: [{ arrayName: '用户格式', index: 9, arrayStart: '[' }],
    customProperties: [{ name: 'myType', field: 'book', value: 'book' }, { name: '用户属性', field: 'all', value: '保留' },
      { name: 'coverLink', field: 'note', value: '用户笔记的封面' }] };
  const f = fixture({ settings });
  assert.equal(await f.ensure(), true);
  assert.equal(f.plugin.settings, settings, 'SettingsManager keeps a reference to this object');
  assert.equal(f.plugin.saves, 1);
  for (const [key, value] of Object.entries(recipe.settings)) assert.deepEqual(settings[key], value);
  assert.equal(settings.loginCookiesContent, 'private-cookie-fixture');
  assert.equal(settings.loginHeadersContent, 'private-header-fixture');
  assert.equal(settings.theaterTemplateFile, '自定义/戏剧.md');
  assert.equal(settings.pictureBedFlag, true);
  assert.equal(settings.debugMode, true);
  assert(settings.arraySettings.some(item => item.arrayName === '用户格式'));
  assert(settings.customProperties.some(item => item.name === '用户属性'));
  assert(settings.customProperties.some(item => item.name === 'coverLink' && item.field === 'note'));
  assert.equal(await f.ensure(), true);
  assert.equal(f.plugin.saves, 1, 'the second import is silent');
  assert.equal(f.modals.length, 1);
});

test('cancel and modal close abort without writes or opening Douban search', async () => {
  for (const choice of ['cancel', 'close']) {
    const f = fixture({ settings: { attachmentPath: '自定义封面' }, choice });
    assert.equal(await f.ensure(), false);
    assert.deepEqual(f.plugin.settings, { attachmentPath: '自定义封面' });
    assert.equal(f.plugin.saves, 0);
    assert.equal(f.commands.length, 0);
  }
});

test('save failure rolls back only managed fields and stops import', async () => {
  const settings = { attachmentPath: '原目录', arraySettings: [{ arrayName: '用户格式' }], loginCookiesContent: 'private-cookie-fixture' };
  const before = copy(settings);
  const f = fixture({ settings, saveError: true });
  assert.equal(await f.ensure(), false);
  assert.deepEqual(settings, before);
  assert.match(f.notices.at(-1), /保存失败/);
});

test('missing plugin, missing templates and malformed recipe never report a successful restore', async () => {
  const absent = fixture();
  delete absent.app.plugins.plugins['obsidian-douban-plugin'];
  assert.equal(await absent.ensure(), false);
  assert.match(absent.notices.at(-1), /安装并启用/);
  const missing = fixture();
  missing.files.delete(recipe.settings.musicTemplateFile);
  assert.equal(await missing.ensure(), false);
  assert.equal(missing.plugin.saves, 0);
  assert.equal(missing.modals.length, 0);
  assert.match(missing.notices.at(-1), /音乐模板/);
  const broken = fixture();
  broken.app.vault.read = async () => '{broken json';
  assert.equal(await broken.ensure(), false);
  assert.match(broken.notices.at(-1), /JSON/);
  const missingRecipe = fixture();
  missingRecipe.files.delete('媒体库/配置/豆瓣导入.json');
  assert.equal(await missingRecipe.ensure(), false);
  assert.equal(missingRecipe.plugin.saves, 0);
});

test('concurrent clicks share one prompt and only one import may proceed', async () => {
  const f = fixture();
  const results = await Promise.all([f.ensure(), f.ensure()]);
  assert.deepEqual(results, [true, false]);
  assert.equal(f.modals.length, 1);
  assert.equal(f.plugin.saves, 1);
});

test('settings edited while the confirmation is open are not overwritten', async () => {
  const f = fixture({ hook: plugin => { plugin.settings.attachmentPath = '确认期间改的目录'; } });
  assert.equal(await f.ensure(), false);
  assert.equal(f.plugin.settings.attachmentPath, '确认期间改的目录');
  assert.equal(f.plugin.saves, 0);
  assert.match(f.notices.at(-1), /确认期间发生变化/);
});

test('recipe cannot restore authentication, unrelated plugin fields or arbitrary named arrays', () => {
  const f = fixture();
  for (const key of ['loginCookiesContent', 'loginHeadersContent', 'pictureBedFlag', 'theaterTemplateFile']) {
    const invalid = copy(recipe); invalid.settings[key] = 'not allowed';
    assert.throws(() => f.manager.plan({}, invalid), /只能包含/);
  }
  const invalid = copy(recipe); invalid.arraySettings[0].arrayName = '用户格式';
  assert.throws(() => f.manager.plan({}, invalid), /列表格式/);
});

test('all nine QuickAdd imports use the guarded gateway and cold-start without Dataview', async () => {
  const quickAdd = JSON.parse(fs.readFileSync(path.join(root, '.obsidian/plugins/quickadd/data.json'), 'utf8'));
  const gateway = require('../媒体库/视图/主题/豆瓣分类导入.js');
  let guarded = 0;
  for (const type of quickAdd.choices[0].choices) {
    const command = type.choices?.[0]?.macro?.commands?.[0];
    if (!command) continue;
    assert.equal(command.type, 'UserScript');
    assert.equal(command.path, '媒体库/视图/主题/豆瓣分类导入.js');
    assert.equal(typeof gateway[command.name.split('::')[1]], 'function');
    guarded++;
  }
  assert.equal(guarded, 9);
  const f = fixture();
  global.window = {};
  assert.equal(await gateway.music({ app: f.app, obsidian: f.obsidian }), true);
  assert.equal(f.plugin.saves, 1);
  assert.deepEqual(f.commands, ['obsidian-douban-plugin:searcher-douban-import-and-create-file-music']);
  assert.equal(global.window.__mediaLibraryDoubanConfig.version, 1);
  const cancelled = fixture({ choice: 'cancel' });
  global.window = cancelled.window;
  assert.equal(await gateway.book({ app: cancelled.app, obsidian: cancelled.obsidian }), false);
  assert.equal(cancelled.commands.length, 0);
});

test('existing QuickAdd macros upgrade narrowly and leave manual and custom workflows unchanged', async () => {
  const choices = new Map([
    ['book-choice', { choices: [{ name: '豆瓣导入图书', macro: { commands: [{ type: 'Obsidian',
      commandId: 'obsidian-douban-plugin:searcher-douban-import-and-create-file-book' }] } },
      { name: '手动新增图书', type: 'Template', templatePath: '用户手动模板.md' }] }],
    ['music-choice', { choices: [{ name: '豆瓣导入音乐', macro: { commands: [{ type: 'UserScript', path: '我的导入.js', name: '自定义脚本' }] } }] }]
  ]);
  const beforeManual = copy(choices.get('book-choice').choices[1]);
  const beforeMusic = copy(choices.get('music-choice'));
  let saves = 0;
  const quickAdd = { getChoiceById: id => choices.get(id), saveSettings: async () => { saves++; } };
  const app = { plugins: { plugins: { quickadd: quickAdd } },
    commands: { findCommand: () => true, executeCommandById: () => true } };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, '媒体库/视图/导入适配/view.js'), 'utf8'), { window, console });
  const types = [{ id: 'book', label: '图书', quickAddChoiceId: 'book-choice' },
    { id: 'music', label: '音乐', quickAddChoiceId: 'music-choice' }];
  await window.__mediaLibraryImportAdapter.launch(app, types[0], types);
  const command = choices.get('book-choice').choices[0].macro.commands[0];
  assert.equal(command.type, 'UserScript');
  assert.equal(command.name, '豆瓣分类导入::book');
  assert.equal(command.commandId, undefined);
  assert.deepEqual(choices.get('book-choice').choices[1], beforeManual);
  assert.deepEqual(choices.get('music-choice'), beforeMusic);
  assert.equal(saves, 1);
  await window.__mediaLibraryImportAdapter.launch(app, types[0], types);
  assert.equal(saves, 1);
});
