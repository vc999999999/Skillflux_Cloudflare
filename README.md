# SkillFlux

显式调用的 Skill 搜索、分发和本地加载系统。终端用户无需账号；技能内容托管在 GitHub 目录仓库，本地 npm/MCP Runtime 按 commit SHA 钉死下载、逐文件校验 sha256 并精确管理版本，网站从目录仓库快照生成静态页面。

```text
mcp/          npm CLI、stdio MCP、目录仓库构建器（catalog build）与 GitHub 源客户端
web/          Astro 网站、静态技能页面、接入指南与机器索引
docs/         运行恢复、接口边界和实际验证记录
```

技能内容仓库：[vc999999999/skillflux-catalog](https://github.com/vc999999999/skillflux-catalog)（`skills/<id>/<version>/` + 生成式 `index.json`，CI 校验一致性）。

## 前端结构

网站统一维护在 `web/`。来源数据在 `web/data/sites.json`，页面与双语组件在 `web/src/`，分享图、图标和字体在 `web/public/`。

公开页面包括资源目录、使用场景、精选合集、指南、安装说明、`/for-ai/` 机器读取说明与 `/submit/` 资源推荐入口，并提供 `/en/` 对应页面。运营台、广告咨询与举报后端已随 2026-10-01 架构改造下线；旧地址由边缘 Worker 重定向。

## 本地运行

需要 Node.js >=22.13.0。

```bash
npm ci
npm run build
npm run dev
```

网站为 `http://127.0.0.1:4321`（无后端服务；开发模式不再启动 Registry）。

`npm run dev:mcp` 与 `npm run dev:web` 可单独运行。开发种子技能在 `mcp/catalog/seed.json`，用 `node mcp/scripts/convert-seed.mjs <dir> --index` 转成本地目录仓库结构；种子自带 simulation 证据，不能获得 qualified 资格。

## 网站采用静态同步

首页、`/registry/`、技能详情、版本历史、更新日志与分类页使用构建时快照，浏览器不为打开这些页面实时联网。同步流程从目录仓库拉取 `index.json` 与文件（钉 commit SHA、验哈希）：

```bash
npm run publication:sync --workspace @skillflux/web -- --repo vc999999999/skillflux-catalog
npm run build --workspace @skillflux/web
```

撤销和资格变化同样需要同步、重建及重新发布才会反映在静态网站中。页面仅代表快照时刻；本地安装和加载会检查当前索引状态，不能把旧网页当作安装授权。

## npm 与 MCP 接入

仓库可以构建 npm 包，本次没有对外发布 npm：

```bash
npm run pack:mcp
# 在使用者项目中安装上一步实际输出的 tgz 文件：
npm install -D /absolute/path/to/skillflux-mcp-1.0.0.tgz
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

只有明确使用 `init --preauthorize-reviewed-text` 的项目才允许 MCP 安装已批准、通过用途/边界/宿主测试的纯文本包。否则使用 CLI 安装。该预授权不能替代升级具体版本的确认。

```bash
skillflux search "code review" --project /absolute/path/to/project
skillflux plan SKILL_ID --version 1.0.0 --project /absolute/path/to/project
skillflux install PLAN_ID --project /absolute/path/to/project
skillflux load SKILL_ID --project /absolute/path/to/project
skillflux check-updates --project /absolute/path/to/project
skillflux pin SKILL_ID --project /absolute/path/to/project
```

搜索在本机缓存的目录索引上进行，检索词不出本机（缓存最长 24 小时）。`check-updates`（别名 `outdated`）只读检查；升级须先 `update SKILL_ID@VERSION` 展示计划，终端确认后执行（非交互需 `--yes`）。MCP `skillflux.update` 只接受明确批准的 `planId`。固定版本须先明确 `unpin`；本地修改、锁冲突或不兼容会阻止执行；离线状态如实标明未知，不宣称「已经最新」。离线可以加载已验签内容，但会披露「当前目录仓库状态未知」。

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

旧 VPS Registry 部署已废弃；服务器已可在确认后下线。备份即 `git clone` / fork 目录仓库。`raw.githubusercontent.com` 在部分网络环境下不可达时，客户端 `--source` 参数可指定镜像源；为 skillflux.cn Worker 增加透传缓存路由是预留的后续选项。
