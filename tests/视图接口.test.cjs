const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, '媒体库/视图/接口/view.js'), 'utf8');

test('custom views obtain the plugin API even when require is absent from their global scope', async () => {
  const api = { Modal: class {}, setIcon() {} };
  const state = { setTimeout, clearTimeout };
  let renders = 0;
  const ctx = {
    window: state, console,
    dv: {
      container: { createDiv: () => ({ remove() {} }) },
      component: {}, currentFilePath: '媒体库/作品/test.md',
      api: { executeJs: async source => {
        renders++;
        await new Promise(resolve => setImmediate(resolve));
        // This is the distinction between inline JS and dv.view's new Function.
        vm.runInNewContext(source, { window: state, require: () => api });
      } }
    }
  };
  vm.createContext(ctx);
  assert.equal(vm.runInContext('typeof require', ctx), 'undefined');
  const run = () => vm.runInContext(`(async () => { ${bridge} })()`, ctx);
  await Promise.all([run(), run()]);
  assert.equal(state.__mediaLibraryObsidian, api);
  assert.equal(renders, 1, 'concurrent views share the pending bootstrap');
  assert.equal(state.__mediaLibraryObsidianRequest, undefined);
  await run();
  assert.equal(renders, 1, 'later views reuse the loaded API');
});

test('custom view bootstrap also handles an Electron require that cannot resolve obsidian', async () => {
  const api = { Modal: class {}, setIcon() {} };
  const state = { setTimeout, clearTimeout };
  const ctx = {
    window: state, console, require: () => { throw new Error('Cannot find module obsidian'); },
    dv: {
      container: { createDiv: () => ({ remove() {} }) }, component: {}, currentFilePath: 'test.md',
      api: { executeJs: async source => vm.runInNewContext(source, { window: state, require: () => api }) }
    }
  };
  vm.createContext(ctx);
  await vm.runInContext(`(async () => { ${bridge} })()`, ctx);
  assert.equal(state.__mediaLibraryObsidian, api);
});

test('delete button can mount without a global require and uses the shared API', () => {
  const events = [];
  const button = { setAttribute() {}, addEventListener: name => events.push(name) };
  const ctx = { window: { __mediaLibraryObsidian: {
    Modal: class {}, setIcon: (_element, icon) => { button.icon = icon; }, setTooltip() {}
  } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, '媒体库/视图/删除/view.js'), 'utf8'), ctx);
  const result = ctx.window.__mediaLibraryDeletion.mount({}, { createEl: () => button }, '媒体库/作品/test.md');
  assert.equal(result, button);
  assert.equal(button.icon, 'trash-2');
  assert.deepEqual(events, ['click']);
});

test('an unavailable optional delete API does not throw during page rendering', () => {
  const ctx = { window: {}, console: { error() {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, '媒体库/视图/删除/view.js'), 'utf8'), ctx);
  assert.equal(ctx.window.__mediaLibraryDeletion.mount({}, {}, '媒体库/作品/test.md'), null);
});
