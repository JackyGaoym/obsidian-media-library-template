# 第三方软件与插件

本仓库只保存兼容设置，不包含 Obsidian、主题或第三方插件的可执行代码。用户应从 Obsidian 官方插件/主题市场安装，以便获得对应作者发布的版本、许可证与更新。

## 必需

### Dataview

- ID：`dataview`
- 用途：执行首页、详情页、类别页和合集页中的 DataviewJS 查询。
- 测试版本：0.5.68。
- 必要设置：`enableDataviewJs: true`。
- 官方市场：[安装页面](https://obsidian.md/plugins?id=dataview)

### Meta Bind

- ID：`obsidian-meta-bind-plugin`
- 用途：交互式状态、评分、收藏、进度、图片与关系字段。
- 测试版本：1.5.1。
- 官方市场：[安装页面](https://obsidian.md/plugins?id=obsidian-meta-bind-plugin)

### QuickAdd

- ID：`quickadd`
- 用途：从首页弹出分层新增菜单，并按模板创建文件。
- 测试版本：2.22.0。
- 配置：`.obsidian/plugins/quickadd/data.json`。
- 官方市场：[安装页面](https://obsidian.md/plugins?id=quickadd)

## 推荐或可选

### Homepage

- ID：`homepage`
- 用途：启动时打开 `媒体库/首页`。
- 测试版本：4.4.4。
- 最低 Obsidian 版本：1.12.2。
- 官方市场：[安装页面](https://obsidian.md/plugins?id=homepage)

### Douban

- ID：`obsidian-douban-plugin`
- 用途：从豆瓣导入公开的图书、影视和游戏元数据。
- 测试版本：2.5.0。
- 官方市场：[安装页面](https://obsidian.md/plugins?id=obsidian-douban-plugin)
- 隐私提示：插件可能在 `data.json` 中保存登录 Cookie 和请求头。本仓库随附配置已清空 `loginCookiesContent` 与 `loginHeadersContent`；用户自行登录后的配置不得提交到公开仓库。
- 稳定性提示：该功能依赖第三方网站，不保证长期可用；手动录入始终是核心后备流程。

### Style Settings 与 Border

- Style Settings ID：`obsidian-style-settings`，测试版本 1.0.9，[安装页面](https://obsidian.md/plugins?id=obsidian-style-settings)。
- Border 主题：测试版本 1.13.7，[主题市场](https://obsidian.md/themes?search=Border)。
- 用途：复现截图中的主题细节。模板自己的 `media-library.css` 仍需启用。

## 没有纳入的插件

原始工作环境里还存在 Calendar、Excalidraw、Media DB、Templater、BRAT、Hover Editor、Open In New Tab 等插件，但当前媒体库核心流程没有引用它们。发布版不将“装了但没用”误写成依赖，免得用户先装一篮子插件再怀疑人生。

Media DB 也没有进入正式录入流程；如未来接入 API，应单独说明数据源、密钥保存位置和隐私风险。
