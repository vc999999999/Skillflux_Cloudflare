# SkillFlux 运行说明

更新日期：2026-10-29（内容站 + 实测数据架构）

## 架构

- **网站**：`web/` 下的 Astro 静态站。构建产物在 `web/dist`，Cloudflare Worker（`web/edge/worker.ts`）负责：
  - 域名统一；
  - 旧 URL 的重定向和 410；
  - 筛选页的 noindex。
- **数据**：全部以 JSON 文件形式放在 `web/data/`，随代码一起评审和提交，没有数据库也没有后端。
- **工具**：`bench/` 负责导入 Skill、L1 体检、L2 实测和发布，网站通过 `@skillflux/bench/*` 共享 schema 和统计函数。

## 例行维护

| 任务 | 频率 | 方式 |
| --- | --- | --- |
| L1 体检 | 每周一 | `.github/workflows/health.yml`：只有结果变化时才开 PR，人工评审后合并 |
| 来源抽样体检 | 每月 2 日 | `.github/workflows/source-audits.yml`：重新钉定并抽样所有 GitHub 来源，开 PR 人工评审 |
| 新增来源 | 按需 | 在 `sites.json` 和 `resource-editorial.json` 各加一条；GitHub 来源再加到 `source-audit-targets.json` 并运行 `npm run bench -- audit --all --missing` |
| 新收录 Skill | 按需 | `bench import` → 写摘要 → `status: listed` → `npm run validate` |
| L2 实测 | 按批次 | 在容器中执行 `bench run` → 复核 → `bench publish` → 转录作为 GitHub Release 附件 |
| 结果更正 | 有 dispute 时 | 体检记录修正后重跑；实测发新批次并 `--supersedes` 旧批次，旧批次不删除 |
| 上游变化 | 出现 `upstream-changed` 标记时 | 人工决定是否重新钉定提交，并重新体检、实测 |

## URL 规则

- 英文在根路径，中文在 `/zh/`。旧的 `/en/*` 一律 301 到对应的根路径。
- 语言切换前，旧的无前缀 `/site/x/`、`/category/x/` 是中文页，现在 301 到 `/zh/resource/…`、`/zh/source-type/…`。
- `skillflux.cn` 的 HTML 请求 308 到 `skillflux.app/zh/…`，机器文件（`.txt`、`.json`、`.xml`）保持原路径。
- 只有中文版本的文章，英文地址 301 到 `/zh/insights/<slug>/`。这些规则由 `build-deployment.ts` 根据构建产物生成。
- 已下线的工具页返回 410：
  - `/install/`、`/setup/`、`/registry/page/*`、`/releases/feed.xml`、`/skills-index.json`；
  - 旧工具里的 `/skills/<旧 id>/` 及其版本页（列表见 `web/data/legacy-tool-urls.json`）；
  - 两个工具专用场景页。
- `/registry/` 301 到 `/directory/`。

上线语言切换后，需要在 Google Search Console、Bing 和百度重新提交 `sitemap.xml`。

## 部署

```bash
npm run deploy
```

Cloudflare Workers Builds 的构建命令为 `npm run build`，产物目录为 `web/dist`。原先由目录仓库触发的 Deploy Hook 已废弃，可以在 Cloudflare 中删除。

## 已归档

- npm 包 `@skillflux/mcp` 与目录仓库 `skillflux-catalog` 的代码保存在 tag `v1.3.0-tool-final`。
- 建议对 npm 包执行 `npm deprecate`，并把目录仓库设为 archived。这两步需要账号权限，由维护者手动完成。
