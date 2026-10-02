# SkillFlux SEO 与部署规则

网站由 Astro 生成静态 HTML，并通过 Cloudflare Worker 发布。资源来源数据位于 `web/data/sites.json`，双语编辑内容位于 `web/data/resource-editorial.json`；精品 Skill 页面由构建时读取的 GitHub 目录仓库快照生成。浏览网页不调用技能下载接口，静态页面的发布状态以构建时间为准。

## URL 与索引

中文页面使用根路径，英文页面使用 `/en/`。可索引页面使用尾斜杠、自 canonical 和对应语言的 hreflang。`web/src/lib/seo-routes.ts` 保留旧来源、分类、安装页路径到现有页面的 301 映射；`web/edge/worker.ts` 处理域名归一、尾斜杠、筛选页和真实 404。

Directory 和 Registry 的搜索、筛选、排序 URL 在首个 HTTP 响应中返回 `X-Robots-Tag: noindex, follow`，HTML 也标注 noindex，canonical 指向主列表。不要在 robots.txt 阻断这些 URL，否则搜索引擎无法读取 noindex。实际存在的 Registry 分页有独立静态路径和 self canonical；不存在的页码不生成页面。

构建后的 `web/scripts/seo-build.ts` 检查标题、描述、H1、正文、内部链接、canonical、hreflang、JSON-LD 和 sitemap 一致性。`lastmod` 使用内容维护日期，缺少可靠日期时省略。不要用构建时间伪造内容更新时间。

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
