# SkillFlux 技术 SEO 实施与验收

本文记录当前仓库实现和发布前检查方式。本轮完成了本地构建、58 个单元测试及 3 个发布集成测试；**未执行生产部署，也未完成搜索引擎或线上性能验收**。

本轮还完成了以下本地验收：

- Astro 与 Worker 类型检查均通过，0 errors、0 warnings。
- Workers 运行时逐一检查 208 条旧地址规则（含有、无尾斜杠），全部返回 301；7 份 sitemap 中 189 个 canonical 页面全部返回 200 且允许索引。
- Workers 与 Pages 两种运行时均验证了筛选页首响应 noindex、canonical、真实 404 和内部配置访问拦截。
- 从首页沿静态 `<a href>` 遍历，没有发现可索引孤立页面。
- 浏览器验证资源页与场景页在 390px 宽度下无页面横向溢出；Directory 搜索、刷新、清空筛选后的 robots 状态正确。

本机没有 Docker / Nginx 运行环境，因此 Nginx 配置完成了静态复核，容器启动及 HTTP 行为仍需在对应部署环境复验。

## 内容维护与索引门槛

目前维护 45 个来源资源。基础资料位于 `web/data/sites.json`，双语编辑内容位于 `web/data/resource-editorial.json`，通过 `web/src/lib/content.ts` 组合成统一资源模型。网页、结构化数据、JSON 索引、LLM 文本及资源订阅使用该模型；sitemap 从同一次构建的可索引 HTML 生成，不另存一套资源清单。精品 Registry 则使用验签后的发布快照，不能用来源目录条目或开发示例替代已审核发布。

新增或更新资源时，补齐以下内容：

- 稳定英文 `resourceSlug`、名称、资源类型、来源类型、原始来源 URL。
- 中英主要能力、独立简介、适用对象、1–3 个使用场景、SkillFlux 点评、局限。
- 替代资源及双语选择理由、相关指南、编辑内容实际修改日期。

统一资源模型的 `updatedAt` 取基础资料和编辑内容的较新修改日期，资源详情、sitemap、JSON、LLM 文本、RSS 和目录排序共用该值。只修改编辑内容时维护 `resource-editorial.json` 对应条目的 `updatedAt`，无需重复修改基础资料日期。

`resource-editorial.ts` 的质量门槛未通过，或资源状态为 `archived`，页面保留但使用 `noindex, follow`，并排除出可索引资源集合。修改旧资源时保留原数据键，调整公开 URL 前同步检查迁移映射。

Tag 需要至少 3 个相关资源、双语独立简介和明确搜索价值。目前合格的 5 个主题为 `agent-skills`、`collection`、`open-source`、`github`、`chinese`；其余 Tag 保持 `noindex, follow`。编辑说明维护于 `web/src/lib/taxonomy.ts`，不能仅因资源数量增加便默认开放索引。

## URL、筛选与分页

中文页面使用根路径，英文页面使用 `/en/`。公开 HTML 路径统一小写英文和尾斜杠；可索引页面各自 self canonical，已存在的语言版本互相声明 hreflang。

| 页面 | 当前路径示例 | 旧地址处理 |
| --- | --- | --- |
| Resource | `/en/resource/anthropic-skills/` | `/en/site/github-com-anthropics-skills/` → 301 |
| Source Type | `/en/source-type/official/` | `/en/category/official/` → 301 |
| Install | `/en/install/` | `/en/setup/` → 301 |
| Registry 分页 | `/en/registry/page/2/` | 有效且不带筛选的 `?page=2` → 对应分页路径 |

迁移清单由 `web/src/lib/seo-routes.ts` 生成，生产部署必须包含构建生成的 HTTP 规则。原 `/sitemap-index.xml`、`/sitemap-0.xml` 也迁移至 `/sitemap.xml`。

Directory、Registry 的搜索、筛选、排序参数在**首个 HTTP 响应**中设置 `X-Robots-Tag: noindex, follow` 和对应 HTML meta，canonical 指向主列表。浏览器交互同步更新 robots，清除筛选后恢复页面原有规则。不要用 robots.txt 阻断这些 URL，否则爬虫无法读取 noindex 和 canonical。

Registry 每页 12 条，实际存在的第 2 页起生成独立 SSG 路径、标题、描述和 self canonical；上下页使用真实 `<a href>`，关闭 JavaScript 仍可翻页。筛选结果分页仍使用客户端交互，空 Registry 为 noindex。不要把第 2 页 canonical 到第 1 页，也不要为不存在的页码生成页面。

## 构建与 sitemap 验收

在仓库根目录运行：

```sh
npm run typecheck --workspace @skillflux/web
npm test --workspace @skillflux/web
npm run build --workspace @skillflux/web
```

正常构建依次执行数据校验、Astro SSG、`web/scripts/seo-build.ts`，最后生成部署规则。`publication:build` 同样检查其独立输出目录；只有验签、构建和 SEO 校验全部成功，才切换已发布目录指针。现有 CI 的 build 步骤执行同一道门槛。

构建失败条件包括缺少 title、description、唯一 H1、有效正文、站内链接、self canonical；同语言重复 title、重复 canonical、canonical 指向不存在或 noindex 页面；无效 JSON-LD、错误或缺少回链的 hreflang、缺失静态内链目标。Resource 额外检查类型、来源链接和五个编辑内容区域；Resource、Use Case、Collection、Guide 详情要求 BreadcrumbList，Guide 要求 Article。

精品 Skill 的页面标题使用「名称（ID）」和「名称（ID@版本）」区分不同条目及版本，允许不同 ID 使用相同显示名称。发布集成测试覆盖同名条目的批准、双语详情与版本页面，以及撤销后的更新。

`/sitemap.xml` 引用以下 7 份分组文件：

```text
/sitemap-resources.xml
/sitemap-use-cases.xml
/sitemap-collections.xml
/sitemap-guides.xml
/sitemap-agents.xml
/sitemap-static.xml
/sitemap-tags.xml
```

只收录存在、可索引且 self canonical 的页面；排除 noindex、跳转、参数筛选和缺失页面。生成后再次检查重复、遗漏及非法条目。`lastmod` 读取页面级 JSON-LD 的真实 `dateModified`；没有可靠内容日期时省略，绝不使用构建时间或部署时间。修改正文才维护对应内容日期。

## 部署配置与本地 HTTP 检查

构建时将 `SITE_URL` 设置为最终公开站点地址，例如 `https://skillflux.cn`。它决定 canonical、hreflang 和 sitemap 域名；不要发布使用 localhost 或预览域名构建的生产产物。

| 部署方式 | 使用配置 | 必须保留的行为 |
| --- | --- | --- |
| Cloudflare Pages 高级模式 | `web/wrangler.toml`，产物 `web/dist` | `_worker.js` 执行迁移和首响应索引规则；`_routes.json` 让 HTML 请求进入 Worker |
| Cloudflare Workers 静态资源 | `web/wrangler.workers.jsonc`，生产产物 `web/.publication/production/dist` | 先执行 `npm run build:production --workspace @skillflux/web`；`ASSETS` 绑定、`run_worker_first: true`、尾斜杠规范化、`404-page`；不能绕过 Worker 直接服务筛选页 |
| Docker + Nginx | `web/Dockerfile`、`web/nginx.conf`、根目录 `compose.yaml` | 构建生成的两份 Nginx 配置复制至 `/etc/nginx/` 并被 include；保留真实 301、自定义真实 404 和筛选响应规则 |

Cloudflare 兼容日期使用 `2026-09-10`，与当前本地 workerd 对齐。升级日期时一并验证本地运行时与部署行为。`build-deployment.ts` 生成 `_worker.js`、路由、迁移及 Nginx 分页配置；这些部署内部文件不应作为公开下载资源。Workers 使用 `.assetsignore` 排除内部文件，Pages 另由 Worker 拒绝访问。

可在 `web` 目录启动与部署一致的本地服务，再检查 HTTP：

```sh
npx wrangler pages dev dist --ip 127.0.0.1 --port 8788
# 或使用 Workers 配置：
npx wrangler dev --config wrangler.workers.jsonc --ip 127.0.0.1 --port 8789
```

Docker 构建需传入正确 `SITE_URL`，通过 compose 配置连接 Registry。Nginx 对静态资源设置缓存，对筛选响应禁用共享缓存；不要删除生成配置或改成所有路径回退首页。

用所选服务检查下列结果，而不是只检查浏览器最终画面：

- 旧来源地址：初始响应为 301，Location 为对应新 Resource，保留必要参数。
- `/directory/?q=test`、`/en/directory/?sort=name`：首响应 HTML 和 HTTP header 均 noindex，canonical 为主 Directory。
- 存在的 Registry 第 2 页：无筛选时 self canonical；有筛选时最终 canonical 为主 Registry，并 noindex。
- 不存在地址：真实 404；部署内部配置文件不可公开读取。
- `/sitemap.xml` 及其分组：200，无 noindex、跳转或参数 URL。

**普通 `astro preview` 只能检查静态内容，不能作为真实 HTTP 301、首响应筛选规则或生产缓存策略的验收依据。** 本地测试中的 13 条签名发布 fixture 已覆盖中英第 2 页、12+1 条可见记录、真实上下页链接、自 canonical 和 sitemap；fixture 只存在于临时目录。

## 发布后仍须完成

上线后建立或确认 Search Console Domain Property，提交 `/sitemap.xml`；对 Resource、Use Case、Collection、Guide 等每种模板抽查 3–5 个 URL，检查 Google 读取的 canonical、索引状态、重复页面和 soft 404。使用 Rich Results Test / 结构化数据检查工具核对可见正文与标记一致，不把结构化数据通过等同于保证出现富结果。

在真实域名与真实用户条件下测量 Core Web Vitals：LCP < 2.5 秒、INP < 200 毫秒、CLS < 0.1。仓库已具备 SSG、自托管字体及缓存基础，但本地构建成功和单元测试通过不能证明这些线上指标达标。GSC、线上 CWV、富结果工具检查目前均为待验；IndexNow 为可选增强，当前未实现自动通知。
