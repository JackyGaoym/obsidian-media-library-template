const fs = require('node:fs');
const path = require('node:path');

const templateRoot = path.resolve(__dirname, '..');
const vaultRoot = path.resolve(templateRoot, '..');
const mode = process.argv[2] || '--check';
if (!['--check', '--write'].includes(mode)) {
  console.error('用法：node scripts/sync-shared.cjs [--check|--write]');
  process.exit(2);
}

const sharedFiles = [
  '.obsidian/snippets/media-library.css',
  '媒体库/首页.md',
  '媒体库/说明/数据字典.md',
  '媒体库/导航/数据健康.md',
  '媒体库/导航/暂停中.md'
];
const viewRoot = path.join(vaultRoot, '媒体库/视图');
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.isFile() && /\.(js|base)$/.test(entry.name)) {
      sharedFiles.push(path.relative(vaultRoot, full));
    }
  }
}
collect(viewRoot);

let differences = 0;
for (const relative of sharedFiles.sort()) {
  const source = path.join(vaultRoot, relative);
  const target = path.join(templateRoot, relative);
  if (!fs.existsSync(source)) {
    console.error(`个人库缺少共享文件：${relative}`);
    differences += 1;
    continue;
  }
  if (!fs.existsSync(target)) {
    differences += 1;
    if (mode === '--write') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      console.log(`已同步：${relative}`);
    } else console.error(`模板缺少共享文件：${relative}`);
    continue;
  }
  const same = fs.readFileSync(source).equals(fs.readFileSync(target));
  if (same) continue;
  differences += 1;
  if (mode === '--write') {
    fs.copyFileSync(source, target);
    console.log(`已同步：${relative}`);
  } else {
    console.error(`尚未同步：${relative}`);
  }
}
if (mode === '--check' && differences) process.exitCode = 1;
else console.log(`已检查 ${sharedFiles.length} 个共享功能文件。`);
