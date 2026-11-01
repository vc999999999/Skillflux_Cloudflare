# SkillFlux SEO 与部署规则

网站由 Astro 生成静态 HTML，通过 Cloudflare Worker 发布。英文在根路径，中文在 `/zh/`。

数据来源：

- 来源黄页：`web/data/sites.json`（基础信息与未核实的 `claims`）、`web/data/resource-editorial.json`（双语编辑内容）。
- 来源抽样体检：`web/data/source-audits/<site>.json`，目标清单在 `source-audit-targets.json`。
- Skill 报告：`web/data/skills`、`web/data/health`、`web/data/benchmarks/runs`。

## URL 与索引

可索引页面使用尾斜杠、自 canonical 和对应语言的 hreflang。`web/src/lib/seo-routes.ts` 保留旧地址的 301 映射（旧的 `/en/*`、`/site/*`、`/category/*`、`/registry/`），以及已下线工具页的 410 规则（`/install/`、`/setup/`、`/registry/page/*`、旧工具的 Skill 版本页）。这些规则用于保住旧链接的收录，不要删除。`web/edge/worker.ts` 负责域名归一、尾斜杠、筛选页和真实 404。

黄页的搜索、筛选、排序 URL 在首个 HTTP 响应中返回 `X-Robots-Tag: noindex, follow`，HTML 也标注 noindex，canonical 指向主列表。不要在 robots.txt 里屏蔽这些 URL，否则搜索引擎读不到 noindex。

构建后的 `web/scripts/seo-build.ts` 检查以下内容，并生成按组拆分的 sitemap（skills、data、resources、comparisons、guides、agents、static、tags）：

- 标题、描述、H1、正文
- 内部链接、canonical、hreflang
- JSON-LD（详情页必须有 BreadcrumbList）
- 来源页的必备区块
- 报告页的首句结论、方法链接与引用块

`lastmod` 只取内容维护日期，没有可靠日期时省略，不用构建时间冒充。

## 对比类页面

| 页面 | 生成规则 |
| --- | --- |
| `/alternatives/<slug>/` | 与该来源至少共享一个用途的来源；少于 3 个时为 noindex |
| `/compare/<a>-vs-<b>/` | 每对编辑推荐的替代来源只生成一次，slug 按字母序排列 |
| `/best/<topic>/` | 按用途或来源类型分组，至少 4 个来源；排序方法写在页面上 |

页面中的百分比是抽样中「无失败项、说明何时使用且带许可证」的条目占比，只反映文件层面的检查。

## 持续更新内容

资源详情可在 `resource-editorial.json` 中补充双语的 `capabilityBreakdown` 和 `workflowSteps`；修改后更新该条的 `updatedAt`。网站类来源的自述数量只能写进 `claims`，并注明出处 URL 与观察日期，不能写进编辑正文。

首页「最近更新」由可索引资源的内容日期和已发布专题的修改日期生成。专题通过 `relatedSites` 关联资源，资源详情页会反向显示对应专题。

## RSS

- `/feed.xml`：合并资源更新、Skill 拆解和实测批次。
- `/insights/feed.xml`：只有拆解文章。
- `/benchmarks/feed.xml`：只有实测结果。

条目 GUID 由内容与维护日期生成（`isPermaLink="false"`），重新构建不会产生重复条目。`lastBuildDate` 取最新条目的维护日期。静态资源的 MIME 由 `web/public/_headers` 声明。

## 验证与发布

在仓库根目录运行：

```sh
npm run typecheck
npm test
npm run build   # 校验数据 → astro build → SEO 检查 → 生成 Worker 规则
```

Cloudflare Workers Builds 从 main 自动构建部署，配置在 `web/wrangler.workers.jsonc`。Worker 必须保留 `ASSETS` 绑定、`run_worker_first`、真实 404 和筛选页首响应规则。本地可用 `npx wrangler dev --config wrangler.workers.jsonc --ip 127.0.0.1 --port 8789` 检查重定向与响应头；`astro preview` 只能检查静态内容。

上线后抽查以下内容：

- 首页、资源详情、对比页
- 筛选 URL、sitemap、404 和域名重定向

本地构建通过不代表搜索引擎已经收录，需要在 Search Console 中查看。
