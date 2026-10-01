# SkillFlux 运行与恢复

## 服务与配置

网站为 Astro 静态构建，Registry 是单实例 Node HTTP 服务与 SQLite。本地 Runtime 由宿主启动 stdio MCP，无需公开端口。持久目录包含私钥、内容、完整评测、商务联系信息及账本；仅授予服务用户读写，不放入网站目录或 npm 包。

当前不支持多个写入实例共享网络卷中的 SQLite；限流为进程内状态，不是持久化分布式反作弊机制。扩容前需要调整数据库、限流和预算协调。

按 `mcp/.env.example` 创建本地 `mcp/.env`，从仓库根构建和启动：

```bash
npm ci
npm run build --workspace @skillflux/mcp
node --env-file=mcp/.env mcp/dist/cli.js registry
```

Node 不自动读取环境文件，须使用 `--env-file` 或进程管理器注入。生产不用 `--dev`。未配置 `SKILLFLUX_ADMIN_TOKEN` 时运营端点关闭；使用独立高熵 token。`SKILLFLUX_PUBLIC_URL` 为终端可访问的外部 HTTPS Origin，`SKILLFLUX_ALLOWED_ORIGINS` 为精确网页 Origin 列表。不要把 token 放进任何 `PUBLIC_*` 变量。

## 静态发布

默认构建读取 `web/data/registry-publication.json`，也可设置 `SKILLFLUX_PUBLICATION_PATH`。同步器检查签名、同一 revision、分页完整性、资格和内容 hash。首次提供可信公钥 JSON（`{keyId,publicKey}`）或显式 TOFU，以后不静默替换身份：

```bash
npm run publication:sync --workspace @skillflux/web -- --registry https://registry.example --trust-key /absolute/path/registry-public-key.json
PUBLIC_REGISTRY_URL=https://registry.example SITE_URL=https://www.example npm run build --workspace @skillflux/web
```

首次 `--accept-first-key` 可替代 `--trust-key`，须自行核对指纹。`--output` 可改同步文件；构建时用 `SKILLFLUX_PUBLICATION_PATH` 的绝对路径读取它。公钥可用于构建，私钥绝不能上传网页。普通构建可以使用仓库空快照，不要求 Registry 在线，也不会公开待审开发样本。

原子发布和持续重建：

```bash
npm run publication:build --workspace @skillflux/web -- --registry https://registry.example --trust-key /absolute/path/registry-public-key.json
npm run publication:watch --workspace @skillflux/web -- --registry https://registry.example --trust-key /absolute/path/registry-public-key.json --interval 60
```

默认当前版本链接为 `web/.publication/current`，服务其中的 `dist/`；同一版本目录保存对应 `registry-publication.json`。可用 `--output POINTER` 或 `SKILLFLUX_PUBLICATION_OUTPUT` 改链接位置，目标必须不存在或是符号链接，不能覆盖普通目录。流水线先同步到临时位置，再构建，成功才原子切换链接；保留旧版本用于回滚，不自动删除。它不修改仓库的空快照或 `web/dist/`。相同 revision 默认跳过重建，`--force` 强制；watch 失败保留当前版本并按间隔重试。

发布、补测、撤销及资格变化后都须同步、重建、重新部署，API 更新或重启不会改变已发布 HTML。页面代表快照时刻，紧急撤销同时更新静态产物及 CDN 缓存。Runtime 安装/加载仍检查当前资格和撤销；已经读入模型上下文的文字不能追回。

## 内部运营

公开 `/console/` 页面已下线，旧地址重定向到 `/registry/`。运营操作通过受保护的 `/v1/admin/` API 完成；Token 不应进入前端静态产物。轮换需更新服务环境并重启。终端用户不用该凭据。生产可用私网进一步限制 `/v1/admin/`。

新提交包含完整 `release`：摘要、破坏性变更、最低客户端版本、维护时间和维护者。自动检查后，录入绑定当前 `contentHash` 的实际人工用途测试、边界测试及全部声明宿主的安装/读取证据，最后填写批准理由。`kind: simulation` 可留档，但不能满足发布门槛。开发 seed 仅待审，缺失的发布元数据应通过新提交版本提供。

首次批准固定签名内容。旧 `approved` 包缺证据时标记 `needs-testing`，不公开正文或下载；在同版本补测并再次批准后，外置 `Signed<QualificationProof>` 绑定原 digest，原 bundle bytes 不变。修改内容本身则须新版本。公开快照只含允许公开的摘要，不泄露完整私人测试及操作员资料。

咨询记录联系信息、公司、产品、网址、需求和用途同意；状态为 `new`、`following-up`、`completed`、`invalid`。完成/无效满 180 天后，服务启动、读取线索或每分钟维护任务清理个人信息，保留状态审计。未关闭线索不自动过期；备份留存须另行管理。咨询只是线索，不自动报价、签约或扣款。

举报支持关联活动详情及处理人/理由。选择暂停时，举报处理、活动停用与未使用 token 失效在同一事务完成。指标按事件日期和活动统计，并提供防公式注入的 CSV 导出。

## 广告计量

- 普通 MCP 与 `run --json` 返回广告数据不计曝光；managed 文本广告成功写出后才确认。客户端确认不证明真人可见。
- 曝光、隐藏、举报事件上报失败时写入本地有界出站队列（最多 1000 条，超出丢弃最旧），下次成功连接 Registry 时按序重发；服务端按 eventId 去重仍视为成功，过期决策等永久拒绝则丢弃，其余失败保留队列。结果区分 `reported`、`queued`、`unknown`：只入队不代表曝光已被确认。关闭广告会清空队列并阻止新事件，长期运行的进程在重发前会重新读取本地策略。
- `dailyCap` 为 UTC 当天签发的付费决策数。预览不创建 token、预留或曝光。
- 可投余额为 `budgetCents - spentCents - reservedCents`。签发时预留一次 CPC，有效点击才记花费，重放不重复计费；过期预留在活动列表读取、相关账本操作或每分钟维护任务中释放，不以失败点击事务回滚释放结果。
- token 最长 10 分钟，签发时冻结文本、落地 URL 与 CPC。活动自然结束不取消已签发且仍有效的 token；暂停会永久作废旧 token 并释放未使用预留，恢复活动不会恢复旧 token。
- 允许的普通上下文无匹配付费活动时可返回 SkillFlux 自有广告。API 失败、`unknown`、敏感上下文、本地关闭时跳过，不生成本地替代。
- 类别和上下文是最小化输入，不上传完整提示词、源码或答案，也不承诺识别全部敏感语义。URL 做基本 HTTPS/公共地址检查，不提供持续落地页审核或域名所有权认证。
- 决策、曝光、点击、举报和花费分开统计，不能冒充独立反作弊或财务审计认证；结算仍依实际合同和无效流量复核。

CTR 的分母是选定时间范围内唯一付费曝光，分子是这些已曝光决策中后来发生点击的数量；按曝光的 UTC 日期归组，跨日点击仍计回原曝光组。自有广告不参与 CTR，没有付费曝光时为 `null`。`clicks` 与 `spentCents` 则按实际点击/账本日期统计，所以 CTR 不应简单用当日点击数除以当日曝光数。JSON 汇总包含 `paidImpressions`、`clickedImpressions`、`ctr`，CSV 行附 `clickedImpressions` 与 `ctr`。

自有广告最终落地到 `SKILLFLUX_PUBLIC_URL` 根路径；独立 API 域名需提供合适网页或安全重定向，Compose 根路径由 Web 提供。

## 本地权限、更新与离线

四种宿主的项目文件见根 README。宿主须启用 MCP 并显式触发 Bootstrap，不能假设新文件会自动加载。项目锁保存精确版本；`check-updates` 只读，普通版本缓存最长 24 小时，资格与撤销每次独立请求。

离线只读取已安装、已验签且已有对应签名资格证明的包，披露时间及当前未知状态；不宣称最新，不新装、升级或回滚。离线的广告事件上报进入本地队列，恢复后按序重发并如实披露排队状态（见广告计量）。精确升级用 `update SKILL@VERSION` 经 TTY 确认或 `--yes`，或审阅计划后 `update --plan PLAN_ID --yes`。MCP 只执行已批准 `planId`，初次安装预授权不授权任意升级。固定版本及依赖须明确解除固定；计划绑定项目、Registry、宿主、精确包、锁修订和时效，锁变化须重建计划。

本地文件、清单、签名资格证明均验证，不静默覆盖编辑。长期 MCP 会重新读取关闭广告和撤销安装权限的操作。已知资格撤回会保留，防止离线复活旧授权；合法新签名授权可恢复同包。回滚也检查当前资格、撤销及本地修改。

## 一致备份与恢复

维护工具无需运营 token，但执行者必须有数据目录权限（也可继续用 `node mcp/dist/registry/maintenance.js` 的位置参数形式）：

```bash
node mcp/dist/cli.js backup --data-dir /srv/skillflux/data --dest /srv/skillflux/backups/2026-09-06
node mcp/dist/cli.js backup --check --backup /srv/skillflux/backups/2026-09-06 --key-id EXPECTED_REGISTRY_KEY_ID
node mcp/dist/cli.js backup --restore --backup /srv/skillflux/backups/2026-09-06 --dest /srv/skillflux/restored-2026-09-06 --key-id EXPECTED_REGISTRY_KEY_ID
```

`--check`/`--restore` 用 `--key-id` 显式核对签名身份，或用 `--data-dir` 指向在线数据目录自动推导。

备份和恢复目标必须不存在，父目录须先存在。备份使用 SQLite `VACUUM INTO` 获取含已提交 WAL 的一致快照，复制原公私钥并签名清单；校验 hash、密钥配对、数据库完整性、外键、支持的 schema 和基础预算一致性。恢复只写新目录，不覆盖运行数据。

预期 key id 应取自已有可信配置，不仅相信备份自身。备份包含明文私钥和全部业务数据，权限不能代替加密；须加密保存、限制访问、管理留存，不放仓库、静态产物或 npm tarball。失败保留原服务，检查不完整目标后换新目标重试。

校验恢复目录后先停服务，再切换 `SKILLFLUX_DATA_DIR` 并启动。先用临时端口和测试项目核对签名、资格、撤销、预算和幂等性，再切入口。原密钥保持客户端信任；更换需独立核对并显式迁移。启动迁移可重复执行，拒绝比当前服务更新的 schema；升级前备份，旧代码不保证支持新 schema。

## Compose 与网络

根 `.env.example` 配置 `docker compose up --build -d`。Web 默认绑定 `127.0.0.1:8080`，同源 `/v1/`、`/r/`、`/health` 代理 Registry；持久卷为 `registry-data`。网站镜像使用已同步的 `web/data/registry-publication.json`，不在构建阶段连接尚未启动的 Registry；更新后 `docker compose up -d --build web` 部署新快照。

`PUBLIC_REGISTRY_URL=/` 仅为浏览器同源 API，同步须真实 HTTPS Origin 或 loopback HTTP。Compose 不把 `.env` 自动导出给宿主 npm，同步时显式传 Registry 与公钥。`SITE_URL` 决定构建 canonical URL。

部署者提供 TLS、探测、WAF、备份调度、CDN 和容量。`/health` 只是进程探测，不等于业务端到端可用。日志避免 token、完整点击 URL、私人测试和源码。默认不信任转发头；仅把稳定代理的精确 IP 加入 `SKILLFLUX_TRUSTED_PROXIES`，入口正确处理转发链。未配置时 Web 转发可能保守共享限流桶，不能以信任任意转发头回避限流。
