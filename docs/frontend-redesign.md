# 前端改版与旧代码清理

当前网站唯一入口是 `web/`。根 `package.json` 使用 `mcp`、`web` 两个 workspace；开发启动器显式将 Astro 指向 `web/`，CI、Docker 与构建命令也使用该 workspace。

## 页面与职责

- `web/src/components/`：共用布局与双语页面组件。
- `web/src/pages/`：中文及 `/en/` 路由、静态机器可读端点。
- `web/src/lib/`：来源目录、场景、合集、搜索和签名发布快照逻辑。
- `web/data/`：来源数据与 Registry 发布快照；网站构建时读取。
- `web/public/`：网站图标、字体与分享图。
- `web/scripts/`：目录校验、静态发布同步、内容工具及浏览器检查。
- 根 `scripts/`：保留跨 workspace 开发启动器与 npm 包烟雾检查。

新增 `/for-ai/` 与 `/en/for-ai/` 汇总现有公开端点；`/submit/` 与 `/en/submit/` 只在浏览器中生成 GitHub Issue 草稿，用户在 GitHub 审阅并发布。推荐入口使用 `SITE.repoUrl`，没有另设公开投稿 API。

`/setup/` 与 `/en/setup/` 按实际 CLI 展示源码打包安装、开发 Registry、项目宿主配置、精确版本计划和更新管理。目录来源不是可安装包；Registry 评测与安装资格检查沿用原有流程。

## 删除依据

本次清理的是上一版留在仓库根目录的静态网站副本。每个剩余根 `src/`、`data/`、`public/` 文件均先核对 `web/` 中对应文件存在；文章与来源数据已经迁移。旧根目录的 Astro、TypeScript 配置没有被当前脚本使用。旧 OG 文件属于被新站分享图取代的生成素材。

保留 `mcp/`、全部运营与架构文档、当前目录数据、内容文章，以及 `scripts/dev.mjs`、`scripts/web-dev.mjs`、`scripts/smoke-package.mjs`。清理前工作区已经存在的删除和其他修改没有还原。

文章管线文档与 `.claude/skills/insight-writer/` 中当前生效的说明、模板和评测输入已同步到 `web/` 路径；过去评测工作区的运行记录保持原样。

这次追加删除的文件：

- `src/components/Breadcrumb.astro`
- `src/components/CollectionListPage.astro`
- `src/components/Footer.astro`
- `src/components/GuideLayout.astro`
- `src/components/GuidesIndexPage.astro`
- `src/components/HomePage.astro`
- `src/components/InsightsIndexPage.astro`
- `src/components/SitePage.astro`
- `src/components/guides/ChoosingASkillSource.astro`
- `src/components/guides/HowToDownloadSkills.astro`
- `src/config.ts`
- `src/content/insights/orange-line-illustration.md`
- `src/content.config.ts`
- `src/layouts/BaseLayout.astro`
- `src/lib/content.ts`
- `src/lib/guides.ts`
- `src/lib/i18n.ts`
- `src/pages/category/[slug].astro`
- `src/pages/en/category/[slug].astro`
- `src/pages/en/guides/choosing-a-skill-source.astro`
- `src/pages/en/guides/how-to-download-claude-skills.astro`
- `src/pages/en/guides/index.astro`
- `src/pages/en/insights/index.astro`
- `src/pages/en/tag/[tag].astro`
- `src/pages/guides/choosing-a-skill-source.astro`
- `src/pages/guides/how-to-download-claude-skills.astro`
- `src/pages/guides/index.astro`
- `src/pages/insights/[slug].astro`
- `src/pages/insights/feed.xml.ts`
- `src/pages/insights/index.astro`
- `src/pages/llms.txt.ts`
- `src/pages/tag/[tag].astro`
- `src/styles/global.css`
- `data/sites.json`
- `public/og.png`
- `astro.config.mjs`
- `tsconfig.json`
- `scripts/add-sites.mjs`
- `scripts/enrich-sites.mjs`
- `scripts/build-og.mjs`
- `scripts/og-image.svg`

## 共用组件与样式收尾

- 删除未被引用的 `web/src/components/ResourceCard.astro`。来源列表统一使用 `ResourceTable.astro`，场景与合集共用编辑页面模板。
- 合并图标为 `Icon.astro`；移除旧首页、导航、页脚和目录遗留的全局样式，以及未引用的卡片网格、信任徽标与深色按钮变体。
- Geist 与 Geist Mono 字体随网站本地提供，并附带 OFL 许可证；图标与分享图统一为新视觉。
- `/index.json` 与 LLM 文本索引同时包含使用场景和精选合集，全部指向现有来源。
- 内部运营台保留中文和 `noindex`，不再生成不存在的英文链接。

## 验证记录（2026-09-29）

- `npm run typecheck`：MCP TypeScript 与 Astro 检查通过；最终 Astro 检查 129 个文件，0 错误、0 警告。
- `npm test`：63 个 MCP 测试、36 个 Web 测试、2 个签名发布集成测试通过。随后新增的 2 个编辑内容测试通过；发现索引更新后重新运行编辑内容、搜索及发现的 14 个相关测试，全部通过。
- `npm run build`：MCP 与网站构建通过；网站生成 214 个页面路由（包含错误页共 215 个 HTML 文件）。
- 对构建产物检查 12,933 个内部链接、资源引用和锚点，缺失数为 0；138 条双语搜索索引目标全部有效。
- 在真实浏览器中验证目录组合筛选、零结果、重置、搜索键盘跳转、手机菜单、手机筛选、安装宿主切换与复制反馈，以及投稿草稿生成。没有对外提交测试内容。
- 对最终静态构建的 6 个核心路由，分别在 320、390、768、1024、1495px 检查布局，共 30 项检查，无页面横向溢出。另检查了场景详情、来源详情、For AI 与精品目录的 390px 布局；安装代码块保留内部横向滚动。
- 没有执行生产部署或 npm 发布。
