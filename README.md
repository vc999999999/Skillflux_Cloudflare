# SkillFlux

显式调用的 Skill 搜索、分发和本地加载系统。终端用户无需账号；本地 npm/MCP Runtime 管理精确版本与验签，Registry 管理评测资格与发布，网站从签名发布快照生成静态页面。

```text
mcp/          npm CLI、stdio MCP、Registry HTTP API 与 SQLite
web/          Astro 网站、静态技能页面、接入指南与内部运营台
docs/         运行恢复、接口边界和实际验证记录
compose.yaml  独立 Registry 与 Web 容器、Registry 持久卷
```

## 前端结构

网站统一维护在 `web/`，根目录只负责编排 `mcp` 与 `web` 两个 workspace。来源数据在 `web/data/sites.json`，页面与双语组件在 `web/src/`，分享图、图标和字体在 `web/public/`。根目录上一版静态网站与重复内容脚本已清理，具体清单见 [前端改版记录](docs/frontend-redesign.md)。

公开页面包括资源目录、使用场景、精选合集、指南、安装说明、`/for-ai/` 机器读取说明与 `/submit/` 资源推荐入口，并提供 `/en/` 对应页面。推荐入口在本地生成 GitHub Issue 草稿，由用户前往 GitHub 审阅和发布；它不直接创建 Registry 可安装包。

## 本地运行

需要 Node.js >=22.13.0。

```bash
npm ci
npm run build
npm run dev
```

网站为 `http://127.0.0.1:4321`，Registry 健康检查为 `http://127.0.0.1:8787/health`，内部运营台位于 `/console/`。开发启动器在终端显示当前进程的随机运营 token；终端用户不需要此 token。

`npm run dev:mcp` 与 `npm run dev:web` 可单独运行。开发模式仅把 `mcp/catalog/seed.json` 导入待审队列，不自动批准或伪造人工评测；公开技能目录为空是合法状态。保留的来源导航和文章不代表已经通过 SkillFlux 评测的可安装包。

## 网站采用静态同步

首页、`/registry/`、技能详情、版本历史、更新日志与分类页使用构建时的签名发布快照，浏览器不为打开这些页面实时查询 Registry。`PUBLIC_REGISTRY_URL` 用于运营台、商务咨询和广告举报等在线操作，不会自动同步公开技能内容。

真实版本通过评测并批准后，同步快照，再重新构建和发布：

```bash
npm run publication:sync --workspace @skillflux/web -- --registry https://registry.example --trust-key /absolute/path/registry-public-key.json
npm run build --workspace @skillflux/web
```

首次同步也可明确使用 `--accept-first-key` 接受 TOFU；此后快照固定原公钥，密钥变化会拒绝同步。先通过可信渠道核对指纹。同步失败保留原快照。默认路径为 `web/data/registry-publication.json`；原子构建与持续同步见 [运行文档](docs/operations.md)。

撤销和资格变化同样需要同步、重建及重新发布才会反映在静态网站中。页面仅代表快照时刻；本地安装和加载会检查当前资格及撤销，不能把旧网页当作安装授权。

## npm 与 MCP 接入

仓库可以构建 npm 包，本次没有对外发布 npm：

```bash
npm run pack:mcp
# 在使用者项目中安装上一步实际输出的 tgz 文件：
npm install -D /absolute/path/to/skillflux-mcp-1.0.0.tgz
npx --no-install skillflux init --project /absolute/path/to/project --registry https://registry.example --host codex
```

源码工作区也可用 `node mcp/dist/cli.js` 代替 `skillflux`。`init` 固定 Registry 公钥，生成项目配置和显式 Bootstrap，保留无关 MCP 条目；不写全局配置。

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

`check-updates`（别名 `outdated`）只读检查，默认刷新；`--cached` 使用最长 24 小时的普通版本缓存。显式加载也可附带更新信息，资格证明和撤销源独立检查。离线结果标记缓存时间和未知状态，不宣称「已经最新」。应用未运行时不会自行推送通知。

升级时选择固定目标：`skillflux update SKILL_ID@VERSION` 展示计划，在终端确认后执行；非交互执行需要 `--yes`，也可先审阅 `plan` 再 `update --plan PLAN_ID --yes`。MCP `skillflux.update` 只接受明确批准的 `planId`。不带精确目标的 `update` 仅检查。固定版本须先明确 `unpin`；本地修改、依赖冲突、锁变化、撤销或不兼容会阻止执行。npm 客户端本身由使用者的包管理器管理。

## 评测与内部运营

`/console/` 的 Bearer token 仅在当前页面内存中保存，刷新、断开或鉴权失效后清除，不进入公开构建或持久存储。新提交先隔离并进行路径、格式、权限、体积等自动检查；发布还要求绑定当前内容 hash 的人工用途与边界测试，以及全部声明宿主的安装/读取记录。模拟测试不能满足生产发布门槛，扫描也不代表效果验证。

公开页面仅展示获准公开的评测摘要；私人输入、输出及操作员记录留在鉴权后台。已公开内容不能覆盖；内容变更使用新版本。历史已公开包可原版本补测并恢复资格，外置签名证明绑定原 digest，不重写已签名包。撤销会级联阻断依赖版本；只有仍具资格且未撤销的版本可安装或回滚。

运营台还管理广告、预算、投放暂停、商务报价线索、举报、日期/活动维度指标与审计。商务咨询要求同意用途并提供联系信息，只收集线索，不自动报价、购买或签约。线索标记完成/无效后保留 180 天，由服务清理流程删除个人信息；未关闭线索不会按此规则自动过期。

## 广告与输出边界

自然排名与广告分离。默认上下文为 `unknown`，不投放；关闭广告或敏感任务同样跳过。明确普通任务可传 `run --ad-context normal`，但类别和上下文声明无法识别全部语义风险。广告请求不上传源码、完整提示词或最终答案。

普通 MCP 只返回独立结构化广告数据，不能保证宿主最终显示，也不因返回数据上报曝光。受控 `run` 在指定命令成功产生非空输出、并得到可用广告后，最多追加一行披露广告；广告故障直接跳过。`run --json` 将原始输出与广告分字段，不计为展示。指定命令需主动读取 `SKILLFLUX_CONTEXT_FILE` 才能使用技能上下文；Runtime 不配置第三方模型账号。

文本广告成功写出后可确认曝光，费用仅按有效点击记账。签名、幂等 token 和 SQLite 事务保护完整性及重复计费，无法证明真人看过广告，也不是独立反作弊认证。UTC `dailyCap` 统计已签发付费决策；可投预算还要扣除未消费 token 的预留。详细口径见 [运行文档](docs/operations.md)。

## 验证与部署

```bash
npm run typecheck
npm test
npm run build
npm pack --workspace @skillflux/mcp --dry-run
npm run smoke:package
```

[验证记录](docs/verification.md) 仅列实际执行结果；[接口契约](mcp/CONTRACT.md) 描述 API 与 Runtime 边界。网站可部署至静态主机，Registry 需要 Node 和持久磁盘。按根 `.env.example` 配置后可 `docker compose up --build -d`；Compose Web 代理在线 API，内容快照仍须提前同步并重建镜像。

数据库、私有签名密钥和账本必须一起备份并加密保存。已提供备份校验和恢复到新目录的工具，详见 [运行与恢复](docs/operations.md)。TLS、域名、生产 token、合同和模型账号由部署者提供；没有执行外部部署、npm 发布或资源购买。
