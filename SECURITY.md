# 安全与隐私

## 报告问题

如果发现模板意外包含账号凭证、Cookie、Token、个人记录或可识别信息，请不要在公开 Issue 中粘贴原文。请先以不暴露秘密的方式描述文件路径与字段名，并立即轮换已经公开的凭证。

## 发布前检查

在仓库根目录执行：

```bash
rg -n -i \
  --hidden \
  'cookie|authorization|bearer|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|/Users/|C:\\\\Users\\\\|file://' \
  -g '!.git/**' \
  -g '!README.md' -g '!SECURITY.md' -g '!THIRD_PARTY.md'
```

命中不一定都是泄露，例如空配置字段与安全文档会被匹配；但每一条都应人工确认。再检查：

```bash
git status --short
git ls-files | rg 'workspace|\.trash|\.DS_Store|plugins/.+/(main\.js|styles\.css|manifest\.json)$'
```

公开派生仓库时，还应检查作品标题、评分、短评、添加日期、截图、图片 EXIF、附件文件名、Git 提交历史，以及提交作者的公开姓名与邮箱。`.gitignore` 只能阻止尚未追踪的文件，不能把已经提交过的秘密从历史里抹掉。

## 已知敏感位置

- `.obsidian/plugins/obsidian-douban-plugin/data.json`：登录 Cookie 与请求头。
- `.obsidian/workspace.json`、`workspace-mobile.json`：最近打开文件、面板布局和路径。
- `.trash/`：已删除但仍保留的笔记与附件。
- `媒体库/作品/`：个人兴趣、进度、日期、评分和短评。
- `媒体库/附件/`、`媒体库/合集/`：版权图片、文件名与个人整理痕迹。
- README 或 Issue 截图：侧边栏、标签页、账号头像、通知和其他仓库名称。

## 第三方内容

不要把插件本体、主题代码、电影海报、剧照、图书封面、字体或其他素材默认视为可再分发内容。优先提供安装链接；示例图应为原创、明确授权或公共领域内容。
