# SkillFlux

SkillFlux 是一个 Agent Skill 的**实测数据站 + 来源黄页**。

- **体检（L1）**：每个收录的 Skill 钉定到一个 Git 提交，按 21 项静态规则检查。
- **实测（L2）**：在 Claude Code 无头模式下做「装 / 不装 Skill」的对照实测。
- **开放数据**：所有结果以 CC BY 4.0 公开，可下载、可校验、可引用。

网站以英文为主（`/`），中文在 `/zh/`。

SkillFlux 不分发、不安装 Skill。原来的 npm/MCP 分发工具已在 tag `v1.3.0-tool-final` 存档并从主线移除。

```text
web/    Astro 静态网站：Skill 报告、实测排行、方法论、数据集、来源目录、Skill 拆解
bench/  数据工具：导入 Skill、L1 体检、L2 实测 runner、发布；任务定义在 bench/tasks/
docs/   运维、SEO、内容管线说明
```

## 本地运行

需要 Node.js >= 22.13。

```bash
npm ci
npm run dev        # http://127.0.0.1:4321
npm run build      # 校验数据 → astro build → SEO 检查 → 生成 Worker
npm test
npm run typecheck
```

## 数据从哪里来

| 数据 | 位置 | 维护方式 |
| --- | --- | --- |
| 来源目录 | `web/data/sites.json`、`resource-editorial.json` | 人工编辑 |
| Skill 记录 | `web/data/skills/<id>.json` | `bench import` 生成草稿，人工写摘要、分类和状态 |
| 体检结果 | `web/data/health/<id>.json` | `npm run health` 生成，每周 CI 重跑 |
| 实测批次 | `web/data/benchmarks/runs/<runId>.json` | `bench publish` 生成，发布后不可修改 |

构建时会校验全部数据：schema、交叉引用、草稿不得公开；每个实测汇总都要能从原始 trial 重新算出。任何一项不通过，构建就会失败。

### 收录一个新 Skill

```bash
GITHUB_TOKEN=$(gh auth token) npm run bench -- import https://github.com/<owner>/<repo> --site <sites.json slug> --category <slug>
GITHUB_TOKEN=$(gh auth token) npm run health
# 编辑 web/data/skills/<id>.json：中英文 summary、tags，status 改为 "listed"
npm run validate
```

### 跑一次实测

步骤和容器要求见 [bench/README.md](bench/README.md)。正式实测只能在容器里运行，并设有预算上限；不花钱的 dry run 用假的 claude 跑通整条流程。

## 部署

```bash
npm run deploy   # SITE_URL=https://skillflux.app 构建后 wrangler deploy（web/dist）
```

更多见 [运维说明](docs/operations.md)、[SEO 说明](docs/seo-implementation.md)、[Skill 拆解管线](docs/insights-pipeline.md)。

## 许可

- 代码：见仓库许可证。
- SkillFlux 的测量数据：CC BY 4.0，引用方式见 [CITATION.cff](CITATION.cff)。
- 第三方 Skill 归原作者所有，遵循其各自的许可证。
