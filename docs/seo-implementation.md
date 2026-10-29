# SkillFlux SEO 与部署规则

网站由 Astro 生成静态 HTML，并通过 Cloudflare Worker 发布。资源来源数据位于 `web/data/sites.json`，双语编辑内容位于 `web/data/resource-editorial.json`；Skill 报告页由 `web/data/skills`、`web/data/health` 与 `web/data/benchmarks/runs` 生成，报告页必须包含首句结论（key-finding）、日期、方法论链接和引用块，数据页必须有带 license 和 distribution 的 Dataset JSON-LD，均由 `seo-build.ts` 校验。英文在根路径，中文在 `/zh/`。

## URL 与索引

中文页面使用根路径，英文页面使用 `/en/`。可索引页面使用尾斜杠、自 canonical 和对应语言的 hreflang。`web/src/lib/seo-routes.ts` 保留旧来源、分类、安装页路径到现有页面的 301 映射；`web/edge/worker.ts` 处理域名归一、尾斜杠、筛选页和真实 404。

Directory 和 Registry 的搜索、筛选、排序 URL 在首个 HTTP 响应中返回 `X-Robots-Tag: noindex, follow`，HTML 也标注 noindex，canonical 指向主列表。不要在 robots.txt 阻断这些 URL，否则搜索引擎无法读取 noindex。实际存在的 Registry 分页有独立静态路径和 self canonical；不存在的页码不生成页面。

构建后的 `web/scripts/seo-build.ts` 检查标题、描述、H1、正文、内部链接、canonical、hreflang、JSON-LD 和 sitemap 一致性。`lastmod` 使用内容维护日期，缺少可靠日期时省略。不要用构建时间伪造内容更新时间。

## 持续更新内容

资源详情可在 `web/data/resource-editorial.json` 中补充双语 `capabilityBreakdown` 和 `workflowSteps`。能力拆解的 `sourceUrl` 应指向实际阅读的固定版本原始说明，正文写清输入、方法、产出与使用条件。修改编辑内容后更新该条 `updatedAt`，无需把上游固定提交改成尚未收录的新版本。

首页的最近更新模块从可索引资源的内容日期和已发布专题的修改日期生成，源码分析与可安装版本仍分别展示。专题使用 `relatedSites` 关联资源的原始 slug，资源详情会自动反向显示对应专题；英文资源页链接中文文章时明确标注语言。

专题与指南提供文章分享元数据。`WebPage`、`Article`、`TechArticle`、`CollectionPage` 的有效 `dateModified` 可进入 sitemap，其中带 URL 的记录必须与当前页面 canonical 一致。专题索引使用实际文章的最新修改日期；首页保留自身编辑日期并结合所展示内容的日期。改动栏目布局或固定文案时也应维护首页的编辑日期，不能用部署时间替代。

## RSS 更新订阅

`/feed.xml` 合并可索引资源、已发布的 Skill 拆解与合格 Skill 包版本；`/insights/feed.xml` 只提供拆解文章，`/releases/feed.xml` 只提供合格版本。分别按资源 `updatedAt`、文章 `dateModified`、版本 `release.maintainedAt`（缺失时使用 `createdAt`）排序，各展示最近 30 条；草稿、不可索引资源和待验证收录不进入对应订阅。页面提供三种 RSS 自动发现链接。

资源和文章 RSS 条目代表页面的最新内容修订。`web/src/lib/rss.ts` 根据实际内容及维护日期生成稳定的修订 GUID，设置 `isPermaLink="false"`；同一文章在两个订阅中的 GUID 相同。同日修改正文也会形成新标识，而重新构建、调整对象字段顺序不会造成重复更新。`lastBuildDate` 来自最新条目的维护日期，不使用构建时钟。实际编辑后仍须正确填写维护日期，供阅读器排序。

2026-10-11 从旧的页面 URL GUID 切换为修订 GUID，首次刷新可能把已有条目识别为未读，这是一次迁移。静态订阅仅保留各页面当前修订，不能补齐两次抓取之间的所有历史编辑。阅读器何时抓取及是否弹出通知由其设置决定。RSS GUID 语义见 [RSS 2.0 规范](https://www.rssboard.org/rss-specification#ltguidgtSubelementOfLtitemgt)。

包版本 GUID 单独按目录仓库、Skill ID 与版本生成，不使用构建时间；同版本重复部署不会重复公告。RSS 不计算用户项目的升级兼容性。流程见 [更新交付说明](update-delivery.md)。

发布验收需检查三个地址返回 `application/rss+xml`、真实文章和资源条目、GUID 稳定性、XML 解析、条件请求及内容日期。Cloudflare 静态资源的响应头由 `web/public/_headers` 声明；只设置 Astro 预渲染函数的响应头不足以验证线上 MIME。

## 验证与发布

在仓库根目录运行：

```sh
npm run typecheck --workspace @skillflux/web
npm test --workspace @skillflux/web
npm run build:production --workspace @skillflux/web
```

生产构建从 GitHub 目录仓库同步并校验快照，再生成静态页面和 SEO 规则。构建失败时不切换有效产物。部署使用 `web/wrangler.workers.jsonc`，Worker 必须保留 `ASSETS` 绑定、`run_worker_first`、真实 404 与筛选页首响应规则；`_worker.js` 等内部部署文件不能公开读取。

本地可在 `web` 目录使用 `npx wrangler dev --config wrangler.workers.jsonc --ip 127.0.0.1 --port 8789` 检查 HTTP 行为。普通 `astro preview` 只能检查静态内容，不能证明 Worker 的重定向、响应头和缓存规则。

上线后应抽查实际域名上的首页、Registry、资源详情、筛选 URL、sitemap、404 和域名重定向。Search Console 的索引状态及真实用户 Core Web Vitals 需要线上数据验证；本地构建通过不等于搜索引擎已经收录。
