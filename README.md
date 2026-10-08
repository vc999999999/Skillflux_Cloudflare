# SkillFlux

显式调用的 Skill 搜索、分发和本地加载系统。终端用户无需账号；技能内容托管在 GitHub 目录仓库，本地 npm/MCP Runtime 按 commit SHA 钉死下载、逐文件校验 sha256 并精确管理版本，网站从目录仓库快照生成静态页面。

```text
mcp/          npm CLI、stdio MCP、目录仓库构建器（catalog build）与 GitHub 源客户端
web/          Astro 网站、静态技能页面、接入指南与机器索引
docs/         运行恢复、接口边界和实际验证记录
```

技能内容仓库：[vc999999999/skillflux-catalog](https://github.com/vc999999999/skillflux-catalog)（`skills/<category>/<id>/<version>/` + 生成式 `index.json`，CI 校验一致性）。

## 前端结构

网站统一维护在 `web/`。来源数据在 `web/data/sites.json`，页面与双语组件在 `web/src/`，分享图、图标和字体在 `web/public/`。

公开页面包括资源目录、使用场景、精选合集、指南、安装说明、`/for-ai/` 机器读取说明与 `/submit/` 资源推荐入口，并提供 `/en/` 对应页面。

## 本地运行

需要 Node.js >=22.13.0。

```bash
npm ci
npm run build
npm run dev
```

网站为 `http://127.0.0.1:4321`，无本地后端服务。

`npm run dev:web` 可单独运行网站。开发种子技能在 `mcp/catalog/seed.json`，用 `node mcp/scripts/convert-seed.mjs <dir> --index` 转成本地目录仓库结构；种子自带 simulation 证据，不能获得 qualified 资格。

## 网站采用静态同步

首页、`/registry/`、技能详情、版本历史、更新日志与分类页使用构建时快照，浏览器不为打开这些页面实时联网。同步流程从目录仓库拉取 `index.json` 与文件（钉 commit SHA、验哈希）：

```bash
npm run publication:sync --workspace @skillflux/web -- --repo vc999999999/skillflux-catalog
npm run build --workspace @skillflux/web
```

撤销和资格变化同样需要同步、重建及重新发布才会反映在静态网站中。页面仅代表快照时刻；本地安装和加载会检查当前索引状态，不能把旧网页当作安装授权。

## npm 与 MCP 接入

1.1.0 安装包通过 [GitHub Releases](https://github.com/vc999999999/Skillflux_Cloudflare/releases/tag/v1.1.0) 分发，可使用 npm 直接安装：

```bash
npm install -g https://github.com/vc999999999/Skillflux_Cloudflare/releases/download/v1.1.0/skillflux-mcp-1.1.0.tgz
skillflux init --project /absolute/path/to/project --repo vc999999999/skillflux-catalog --host codex --update-policy follow-compatible
```

也可从本仓库构建并在项目内安装：

```bash
npm run pack:mcp
# 在使用者项目中安装上一步实际输出的 tgz 文件：
npm install -D /absolute/path/to/skillflux-mcp-1.1.0.tgz
npx --no-install skillflux init --project /absolute/path/to/project --repo vc999999999/skillflux-catalog --host codex
```

源码工作区也可用 `node mcp/dist/cli.js` 代替 `skillflux`。`init` 固定目录仓库身份，生成项目配置和显式 Bootstrap，保留无关 MCP 条目；不写全局配置。

| `--host` | MCP 配置 | Bootstrap |
| --- | --- | --- |
| `codex` | `.codex/config.toml` | `.agents/skills/skillflux/`，禁止隐式调用 |
| `claude` | `.mcp.json` | `.claude/skills/skillflux/`，`disable-model-invocation: true` |
| `cursor` | `.cursor/mcp.json` | `.cursor/skills/skillflux/`，`disable-model-invocation: true` |
| `generic` | `.mcp.json` | `.skillflux/bootstrap/skillflux/`，由宿主显式加载 |

宿主需要重新读取项目配置并启用 MCP。Codex 显式使用 `$skillflux`；其他宿主通过其用户触发入口或明确要求使用 SkillFlux，通用宿主可能需手动读取 Bootstrap。Runtime 直接在当前轮返回完整技能入口与所需资源，不依赖新文件自动发现。生成这些配置不等于已经验证所有真实宿主版本。

只有明确使用 `init --preauthorize-reviewed-text` 的项目才允许 MCP 首次安装已批准、通过用途/边界/宿主测试的纯文本包。否则使用 CLI 安装。首次安装预授权和自动更新策略独立：开启其中一项不会自动开启另一项。

```bash
skillflux search "code review" --project /absolute/path/to/project
skillflux plan SKILL_ID --version 1.0.0 --project /absolute/path/to/project
skillflux install PLAN_ID --project /absolute/path/to/project
skillflux load SKILL_ID --project /absolute/path/to/project
skillflux check-updates --project /absolute/path/to/project
skillflux pin SKILL_ID --project /absolute/path/to/project
```

搜索在本机缓存的目录索引上进行，检索词不出本机（缓存最长 24 小时）。`check-updates`（别名 `outdated`）只读检查。手动升级使用 `update SKILL_ID@VERSION` 展示计划，终端确认后执行（非交互需 `--yes`）；MCP `skillflux.update` 只接受明确批准的 `planId`。

### 一次开启，使用时自动跟随内容更新

新项目可在初始化时明确开启：

```bash
skillflux init --project /absolute/path/to/project --repo vc999999999/skillflux-catalog --host codex --update-policy follow-compatible
```

已有项目可用一条命令开启，也可以随时查看或关闭：

```bash
skillflux update-policy follow-compatible --project /absolute/path/to/project
skillflux update-policy --project /absolute/path/to/project
skillflux update-policy manual --project /absolute/path/to/project
```

默认是 `manual`，已有项目不会被静默开启。选择 `follow-compatible` 后，CLI 或 MCP 的每次 `load` 会在返回正文前尝试检查并同步已审核、无破坏性变化、兼容当前宿主与客户端的稳定版本。仅在同一 major 内跟随；`0.x` 版本仅跟随同一 minor 的补丁。Skill 正文、参考资料与模板随包一起更新，并校验完整依赖计划、commit SHA 与逐文件哈希。MCP 没有修改这项持久授权的工具。

固定版本、本地修改、跨 major、预发布版本、中间版本的破坏性变化、权限、发布者或维护者变化都会阻止自动更新。冲突或失败不会覆盖已安装内容；离线时仍可读取通过本地完整性校验的旧内容，并标明当前目录状态未知。已知撤销或本地内容被改动时仍拒绝加载。`load` 返回自动更新结果、版本变化和阻止原因。开启跟随时，回滚后恢复的版本会固定，需明确 `unpin` 才能继续跟随。

这是**技能内容更新**，不是 npm/MCP 程序自更新。旧客户端用户需要先安装包含此功能的新 npm 包，再用原来的 `--repo` / `--host` 重新运行 `init` 同步入口并重启 MCP；随后开启策略即可。程序或宿主未运行时不在后台同步，你发布的新版在用户下次联网加载时生效。

## 目录仓库维护

```bash
skillflux catalog /path/to/skillflux-catalog            # 扫描 + 生成 index.json
skillflux catalog /path/to/skillflux-catalog --check    # CI：index 与目录不一致即失败
```

同一 `<id>/<version>/` 目录内容不可变；内容变更必须新增版本目录。`skillflux.review.json` 记录审核状态与绑定内容哈希的人工评测；`kind: "simulation"` 不能满足发布门槛。撤销 = 将该版本 review status 改为 `revoked` 并重建 index，依赖它的合格版本派生状态随之失效。

仓库安全要求（GitHub 侧配置）：账号 2FA、main 分支保护、禁 force-push。免签名信任模型的完整性防线是 commit SHA 钉扎 + 逐文件 sha256 + CI 一致性检查。

## 验证与部署

```bash
npm run typecheck
npm test
npm run build
npm run pack:mcp --dry-run
npm run smoke:package
```

[验证记录](docs/verification.md) 仅列实际执行结果；[接口契约](mcp/CONTRACT.md) 描述目录格式、信任模型与 Runtime 边界。网站部署至 Cloudflare Workers：

```bash
npm run build:production --workspace @skillflux/web   # 从真实目录仓库同步并构建
npm run deploy:production --workspace @skillflux/web  # wrangler 部署
```

技能内容仓库可通过 `git clone` 或 fork 备份。`raw.githubusercontent.com` 在部分网络环境下不可达时，客户端 `--source` 参数可指定镜像源；为 skillflux.app Worker 增加透传缓存路由是预留的后续选项。
