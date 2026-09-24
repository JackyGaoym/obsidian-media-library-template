const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));
const list = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? list(path.join(directory, entry.name))
    : [path.join(directory, entry.name)]);

const views = list('媒体库/视图').filter(file => file.endsWith('.js'));
for (const file of views) {
  assert.doesNotThrow(() => new vm.Script(`(async () => {\n${read(file)}\n})`, { filename: file }),
    `视图语法错误：${file}`);
}
const home = read('媒体库/首页.md').match(/```dataviewjs\n([\s\S]*?)\n```/)?.[1];
assert(home, '首页缺少 DataviewJS');
assert.doesNotThrow(() => new vm.Script(`(async () => {\n${home}\n})`), '首页脚本语法错误');

for (const file of [...views, '媒体库/首页.md', ...list('媒体库/导航').filter(item => item.endsWith('.md'))]) {
  for (const [, view] of read(file).matchAll(/dv\.view\(["'](媒体库\/视图\/[^"']+)["']/g)) {
    assert(exists(`${view}/view.js`), `${file} 引用了不存在的视图：${view}`);
  }
}

const typeLabels = {
  book: '图书', tv: '电视剧', movie: '电影', anime: '动漫',
  game: '游戏', variety: '综艺', documentary: '纪录片'
};
const config = JSON.parse(read('媒体库/配置/作品类型.json'));
const propertyTypes = JSON.parse(read('.obsidian/types.json')).types;
assert.equal(propertyTypes.record_state, 'text', '缺少记录重开状态的字段类型');
assert.equal(propertyTypes.current_experience_origin, 'text', '缺少迁移来源字段类型');
const typeView = read('媒体库/视图/类型/view.js');
const allBase = read('媒体库/视图/数据表/全部作品.base');
for (const [id, label] of Object.entries(typeLabels)) {
  assert(config.order.includes(id), `类型配置缺少 ${id}`);
  assert(typeView.includes(`id: "${id}"`), `类型定义缺少 ${id}`);
  assert(allBase.includes(`media_type == "${id}"`) && allBase.includes(`"${label}"`), `全部作品 Base 缺少 ${label}`);
}
assert(allBase.includes('media_format == "series"') && allBase.includes('media_format == "movie"'),
  '全部作品 Base 未按 media_format 显示进度');
assert(read('媒体库/首页.md').includes('媒体库/导航/数据健康'), '首页缺少数据健康入口');
assert(read('媒体库/首页.md').includes('媒体库/导航/暂停中'), '首页缺少暂停列表入口');
for (const line of allBase.split(/\r?\n/).filter(item => /^  (type_label|progress_label):/.test(item))) {
  let depth = 0;
  let quoted = false;
  for (const char of line.split(': ', 2)[1]) {
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      assert(depth >= 0, `Base 公式括号不平衡：${line}`);
    }
  }
  assert(depth === 0 && !quoted, `Base 公式括号或引号不平衡：${line}`);
}

const demos = {
  '媒体库/作品': new Set([
    '星际邮差（2023）.md', '星际邮差：回声（2026）.md', '月面电台（2025）.md',
    '海风书店（2024）.md', '群岛来信（2020）.md', '零号花园（2022）.md',
    '雾城档案（2026）.md', '风筝与雨季（2021）.md'
  ]),
  '媒体库/合集': new Set(['宇宙漫游.md', '星际邮差系列.md']),
  '媒体库/记录': new Set([
    '星际邮差（2023） · 第1次.md', '星际邮差（2023） · 第2次.md',
    '群岛来信（2020） · 第1次.md', '风筝与雨季（2021） · 第1次.md'
  ])
};
for (const [folder, allowlist] of Object.entries(demos)) {
  const files = list(folder).filter(file => file.endsWith('.md'));
  assert.equal(files.length, allowlist.size, `${folder} 的示例笔记数量变化，需先检查发布边界`);
  for (const file of files) {
    assert(allowlist.has(path.basename(file)), `发布包出现未审核的笔记：${file}`);
    assert(/^---\r?\n[\s\S]*?\r?\n---/.test(read(file)), `示例笔记缺少 frontmatter：${file}`);
  }
}

const pluginsRoot = path.join(root, '.obsidian/plugins');
for (const plugin of fs.readdirSync(pluginsRoot)) {
  const configPath = path.join(pluginsRoot, plugin, 'data.json');
  if (!fs.existsSync(configPath)) continue;
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const visit = (value, keys = []) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const next = [...keys, key];
      if (/cookie|token|api.?key|password|authorization/i.test(key) && typeof child === 'string') {
        assert.equal(child.trim(), '', `插件配置含非空凭据：${plugin}/${next.join('.')}`);
      }
      visit(child, next);
    }
  };
  visit(data);
}

const tests = fs.readdirSync(path.join(root, 'tests'))
  .filter(file => file.endsWith('.test.cjs'))
  .map(file => path.join(root, 'tests', file));
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.error) throw result.error;
assert.equal(result.status, 0, '回归测试失败');
console.log(`发布校验通过：${views.length} 个视图、${tests.length} 个测试文件、七类数据及示例边界。`);
