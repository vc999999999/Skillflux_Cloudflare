# SkillFlux MCP 架构规格

状态：Draft v0.2（已完成无上下文读者测试）  
范围：云端 Skill Registry、本地按需加载、MCP 接入、透明推荐  
目标读者：产品、客户端、云端与安全工程

## 1. 决策摘要

SkillFlux 采用“本地 MCP Runtime + 云端 Registry/CDN”的混合架构。

- AI 宿主只连接一个本地 SkillFlux MCP Server。
- 本地 MCP Server 负责项目目录授权、下载、验签、缓存、lockfile 和 Skill 加载。
- 云端负责版本解析、不可变包分发、撤回列表和可选的推荐活动。
- 官网继续保持 Astro 静态站，只承担产品说明、目录浏览和文档。
- 推荐与 AI 正文隔离。支持 MCP Apps 时渲染独立卡片；不支持时由 SkillFlux 自有 CLI/插件渲染。

MCP 不是“广告注入器”。普通 MCP Server 不能拦截宿主里的每一次最终回复，因此不能承诺所有 Codex、Claude、Cursor 输出都会带一句推荐。

## 2. 目标与非目标

### 2.1 目标

1. Agent 能按任务发现并加载一个 Skill，而不是预装整个集合。
2. Skill 精确版本可固定、验证、更新、撤回和回滚。
3. 原始 prompt、源码和项目文件默认不离开本机。
4. 对本地文件的所有写入都限定在用户授权的项目目录。
5. 推荐内容明确标注、可以关闭，不进入 Skill 指令，也不改变自然排序。
6. 首版兼容至少一个主流 MCP 宿主，并为其他宿主保留 adapter。

### 2.2 非目标

1. 首版不运行任意第三方 Shell 脚本。
2. 首版不支持 Skill 之间的任意依赖解析。
3. 不利用 Skill 提示词强迫模型复述广告。
4. 不保证在未调用 SkillFlux 工具的普通对话中展示推荐。
5. 不把 MCP tool annotations 当成安全边界；它们只是提示。

## 3. 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│ AI Host                                                      │
│ Codex / Claude / Cursor                                      │
│                                                              │
│  Model ── tools/call ──► SkillFlux MCP App（可选 UI）         │
└───────────────────────┬──────────────────────────────────────┘
                        │ MCP over stdio
┌───────────────────────▼──────────────────────────────────────┐
│ Local SkillFlux MCP Runtime                                  │
│                                                              │
│ Tool Router      Project Allowlist     Host Adapter           │
│ Resolver         Manifest Validator    Skill Context Loader   │
│ Downloader       Signature Verifier    Recommendation UI      │
│ Blob Cache       Lockfile Manager      Local Event Buffer     │
└───────────────┬───────────────────────┬──────────────────────┘
                │ HTTPS                 │ 本地受限写入
                │                       ▼
┌───────────────▼──────────────┐   .skillflux/
│ SkillFlux Cloud              │   ├── lock.json
│                              │   ├── policy.json
│ Registry Resolver API        │   └── skills/{id}/{version}/
│ Recommendation API（可选）   │
│ Revocation Feed              │
│ Event API（可选）            │
└───────────────┬──────────────┘
                │
┌───────────────▼──────────────┐
│ Object Storage / CDN         │
│ manifests / bundles / UI     │
└──────────────────────────────┘
```

## 4. 为什么必须是本地 MCP

只有远程 MCP 时，服务端位于云端：

- 它可以搜索 Registry、返回 manifest 或下载地址。
- 它不能天然访问用户本地项目目录。
- 即使宿主把文件路径告诉它，也不应把源码上传到云端再写回来。
- 不同宿主对工具结果、文件权限和 UI 渲染的支持不同。

本地 MCP Runtime 通过 stdio 运行在用户机器上，可以在受控目录内执行确定性操作。它对云端只发送结构化能力标签和版本信息，不发送项目内容。

远程 MCP 可以作为未来的“只读发现入口”，但不能替代本地安装 Runtime。

## 5. 运行时调用流程

### 5.1 首次解析与安装

```text
1. 用户提出任务
2. Agent 调用 skillflux.resolve_skill
3. Agent 将任务概括为粗粒度 capability；本地 Runtime 只做格式规范化与策略检查
4. Runtime 从静态 Registry 索引本地解析，或请求动态 Registry API 解析兼容版本
5. Registry 返回 manifest、digest、签名和下载地址
6. Runtime 返回安装计划，不立即写文件
7. 具备可信审批通道的宿主向用户展示版本、权限和文件变更
8. 用户在宿主 UI 明确批准后，宿主才允许 skillflux.apply_plan 执行
9. Runtime 下载不可变 bundle 并校验哈希、签名、撤回状态
10. Runtime 写入 .skillflux/skills 与 lock.json
11. Agent 调用 skillflux.load_skill_context
12. Runtime 返回 Skill 指令和资源，Agent 继续原任务
```

安装和加载分成两个调用，避免模型一次调用就完成未经确认的本地写入。

### 5.2 后续任务

如果 lockfile 中已经存在兼容版本：

1. Runtime 先使用本地版本。
2. Runtime 存活时可以后台检查更新；短生命周期 stdio 模式则在下一次调用时机会式检查，不阻塞任务。
3. 云端不可用时继续使用最后一个已验证版本。
4. Runtime 使用最后一次有效的签名撤回列表。新安装必须取得未过期列表；离线加载已安装的声明式 Skill 可以按本地策略继续，但必须显示撤回状态未知。

## 6. MCP 工具面

首版保持工具数量少且稳定，避免安装一个 Skill 就动态增加一批工具。

| Tool | 类型 | 用途 |
|---|---|---|
| `skillflux.resolve_skill` | 只读 | 从任务能力解析候选 Skill，返回安装计划 |
| `skillflux.apply_plan` | 写入 | 用户批准后下载、验签并写入当前项目 |
| `skillflux.load_skill_context` | 只读 | 将已安装 Skill 的指令与资源返回给 Agent |
| `skillflux.list_installed` | 只读 | 列出当前项目版本、状态与权限 |
| `skillflux.check_updates` | 只读 | 检查更新、撤回和兼容性变化 |
| `skillflux.remove_skill` | 删除 | 从项目移除 Skill 并更新 lockfile |
| `skillflux.rollback` | 写入 | Phase 1 恢复到 lockfile 历史中的已验证版本 |

### 6.1 `resolve_skill`

输入：

```json
{
  "capability": "research-synthesis",
  "project_id": "current",
  "host": "codex",
  "constraints": {
    "network": false,
    "shell": false,
    "preferred_language": "zh-CN"
  }
}
```

输出：

```json
{
  "plan_id": "plan_01J...",
  "expires_at": "2026-09-04T15:00:00Z",
  "skill": {
    "id": "research-synthesis",
    "version": "1.8.2",
    "publisher": "skillflux",
    "digest": "sha256:..."
  },
  "permissions": [],
  "files": ["SKILL.md", "references/method.md"],
  "requires_approval": true
}
```

`plan_id` 由本地 Runtime 生成并密封，绑定项目、manifest digest、用户策略和过期时间，不能在批准后被服务端替换。它证明“计划未改变”，不证明“用户已批准”。

### 6.2 `apply_plan`

输入只接收 `plan_id`，不允许模型重新指定任意下载 URL：

```json
{
  "plan_id": "plan_01J..."
}
```

Runtime 从已验证计划中读取 URL、digest 和目标目录。`apply_plan` 只在 adapter 已确认宿主提供可信的人类审批通道时注册；不具备该能力的宿主只能得到 CLI 安装指令。用户也可以在本地策略中预先批准明确范围，但模型不能生成或模拟审批凭证。

写入时先落到临时目录，检查路径穿越、符号链接、硬链接、设备文件、解压后总大小和文件数量；全部校验通过后再原子切换。

### 6.3 `load_skill_context`

输入：

```json
{
  "skill_id": "research-synthesis",
  "project_id": "current",
  "resources": ["references/method.md"]
}
```

MVP 不做语义裁剪：输出 manifest 声明的主入口和调用方明确请求的资源。后续版本可以增加本地索引，但裁剪规则必须可重复、可审计，且不得把原始任务上传云端。

## 7. 项目目录与宿主适配

```text
.skillflux/
├── lock.json
├── policy.json
└── skills/
    └── research-synthesis/
        └── 1.8.2/
            ├── manifest.json
            ├── SKILL.md
            └── references/
```

MVP 每个 Runtime 进程只绑定一个项目根目录。adapter 启动本地 MCP Server 时通过受信配置传入根目录；Runtime 立即做 `realpath` 规范化并生成不包含路径的内部 `project_id`。所有写入再次 `realpath` 检查，拒绝 `..`、绝对路径参数和符号链接逃逸。模型只能提交 `project_id: "current"`，不能自由提交路径。多根项目留到后续版本。

不同宿主由 adapter 处理：

- MCP 可直接加载的宿主：通过 `load_skill_context` 在同一任务中使用；是否能在同一回合继续由宿主能力决定。
- 支持项目级原生 Skills 的宿主：在用户批准后生成项目内索引或配置。
- 需要重载的宿主：安装结果明确返回 `reload_required: true`。

MVP 不写宿主全局配置目录。全局安装需要独立权限、独立计划和再次确认，留到后续版本。

不把 MCP Roots 作为唯一项目发现方式。新实现使用服务器配置、环境配置、资源 URI 或显式工具参数；旧客户端可以保留 Roots 兼容层。

## 8. Skill 包与签名

首版 Skill 包只允许声明式内容：Markdown、JSON、静态资源和受限制模板，不允许任意可执行脚本。

`manifest.json` 至少包含：

```json
{
  "schema": 1,
  "id": "research-synthesis",
  "version": "1.8.2",
  "publisher": "skillflux",
  "entry": "SKILL.md",
  "digest": "sha256:...",
  "files": [{"path": "SKILL.md", "sha256": "..."}],
  "capabilities": ["research-synthesis"],
  "adapters": ["codex", "claude", "cursor"],
  "permissions": {"network": [], "shell": false, "secrets": []},
  "min_runtime": "0.1.0",
  "license": "MIT",
  "signature": {"key_id": "publisher_...", "value": "..."}
}
```

安全规则：

- bundle 以 digest 寻址，已发布内容不可原地覆盖。
- manifest 和所有文件都参与签名。
- CDN 地址不能成为信任来源，签名与哈希才是。
- Runtime 定期获取签名的撤回列表。
- 更新默认生成新计划，不静默改变 lockfile。
- lockfile 不是信任根。Runtime 每次加载都以已签名 manifest 和已安装文件哈希重新验证；lockfile 被修改时触发重新校验与审计。
- 签名只能证明来源和完整性，不能证明 Markdown 指令安全。所有 Skill 仍需静态扫描、人工审核和紧急下架流程。

## 9. 推荐系统

### 9.1 能力边界

MCP 工具是由模型选择调用的能力，不是宿主最终输出的全局中间件。因此：

- 仅靠 MCP tool result，不能保证模型最终复述推荐。
- 仅靠 Skill 指令要求“回答末尾说一句广告”不稳定且破坏信任。
- 要稳定展示，必须控制 UI、CLI wrapper 或宿主插件。

### 9.2 推荐的实现

支持 MCP Apps 的宿主：

1. SkillFlux 工具声明一个 `ui://skillflux/result` UI resource。
2. 正常工具结果只返回任务所需的数据。
3. UI 渲染后调用一个 `_meta.ui.visibility: ["app"]` 的 `skillflux.resolve_recommendation` 工具，使其不进入模型工具列表。
4. 推荐以独立卡片显示，不写入模型上下文。
5. 点击、关闭和举报事件从 UI 发送，不经过模型。

不支持 MCP Apps 的宿主：

- SkillFlux 自有 CLI/IDE 插件在回答完成后追加固定格式区块；或者
- 不展示推荐。不要退化为隐蔽 prompt 注入。

推荐对象：

```json
{
  "type": "sponsored",
  "campaign_id": "cmp_...",
  "sponsor": "Example Product",
  "headline": "把镜头清单整理成协作分镜",
  "reason": "当前任务类别为 video-storyboarding",
  "url": "https://example.com/...",
  "disclosure": "合作推荐",
  "expires_at": "2026-09-30T00:00:00Z",
  "signature": "..."
}
```

广告主只能提交审核过的结构化字段和域名，不能提交 prompt、工具调用或可执行内容。

### 9.3 默认隐私与频控

- Agent 提交粗粒度任务分类，本地 Runtime 负责校验和敏感类别阻断。只有 SkillFlux 自有 wrapper 才可选择在本地运行额外分类器。
- 默认只上传 `skill_id`、任务分类、语言、地区粗粒度和匿名频控标识。
- 不上传原始 prompt、回答、源码、文件名或文件内容。
- 前 3 次任务不展示；之后最多每天 1 次、每周 2 次。
- 同一品牌设置 7 天冷却。
- 医疗、法律、金融、危机与安全事故任务默认禁用。
- 用户与企业管理员都可以完全关闭。

## 10. 云端接口

MVP 可以先用静态 Registry，商业化后再引入动态服务。

### 10.1 静态 MVP

```text
GET /registry/v1/index.json
GET /registry/v1/manifests/{id}/{version}.json
GET /registry/v1/bundles/{digest}.tgz
GET /registry/v1/revocations.json
```

这些文件可部署在 R2/S3 + CDN。版本匹配和策略过滤在本地 Runtime 完成。

### 10.2 动态阶段

```text
POST /v1/resolve
POST /v1/recommendations/resolve
POST /v1/events
GET  /v1/publishers/{id}/keys
```

动态服务增加账号、团队策略、活动实时上下架、归因与发布者管理。远程 MCP 接口是可选的；本地 Runtime 与云端之间使用普通 HTTPS API 更简单。

## 11. 身份与授权

- 本地 stdio MCP 不使用远程 OAuth；凭证从宿主安全配置或系统密钥链读取。
- 云端 API 使用短期 access token，token 只发给 SkillFlux 资源域。
- 企业策略与发布权限使用独立 scope。
- 不允许 token passthrough 给第三方 Skill 或广告主。
- 所有远程端点使用 HTTPS。

未来若暴露远程 MCP，应按当期 MCP Authorization 规范实现 OAuth 发现、PKCE、资源受众绑定和 issuer 校验。

## 12. 安全边界

1. **项目边界**：启动配置生成 allowlist；所有规范化后的写入路径必须位于 allowlist 内。
2. **计划绑定与审批**：安装只接受本地密封的 `plan_id`，拒绝模型提供任意 URL；`plan_id` 不能代替宿主 UI 或 CLI 的人类批准。
3. **供应链**：digest、publisher signature、撤回列表和最小 Runtime 版本必须同时验证。
4. **权限**：首版无 Shell、无 secrets、默认无网络。
5. **安全解包与原子写入**：拒绝路径穿越、链接、设备文件和解压炸弹；临时目录校验完成后再切换，失败不留下半安装状态。
6. **推荐隔离**：推荐服务不能改变 Skill 排名、内容、工具结果或系统提示词。
7. **数据最小化**：原始对话和源码不进入遥测。
8. **可审计性**：安装、更新、删除和推荐设置变更写入本地审计记录。

## 13. 兼容策略

- 本地连接首选 stdio，获得最广泛的桌面与 IDE 宿主兼容性。
- Runtime 使用稳定且固定版本的 MCP SDK，并在测试矩阵中覆盖目标宿主。
- 新协议实现不依赖 Roots；为仍支持旧版 Roots 的客户端保留兼容读取。
- MCP Apps 仅做增强能力，文本工具调用始终可以完成核心 Skill 工作流。
- 推荐卡在不支持 MCP Apps 的客户端中不应阻塞 Skill 使用。
- adapter 必须实测 MCP App 的工具可见性和上下文隔离；未验证前默认关闭推荐。

## 14. MVP 交付顺序

### Phase 0：验证核心闭环

- 一个本地 TypeScript MCP Server。
- 一个目标宿主。
- 10 个由 SkillFlux 签名的声明式 Skill。
- 静态 Registry + CDN。
- `resolve_skill`、`apply_plan`、`load_skill_context`、`list_installed`。
- 项目 allowlist、SHA-256、签名、lockfile、离线缓存。
- 单项目根目录、可信审批能力探测和 CLI 降级。
- 暂不展示商业推荐。

### Phase 1：安全与多宿主

- Claude、Codex、Cursor adapters。
- 更新、撤回、回滚、删除和审计。
- 发布者密钥与自动扫描。
- 宿主兼容性测试矩阵。

### Phase 2：透明推荐实验

- MCP App 推荐卡与设置页。
- 本地分类、频控、敏感类别阻断。
- 广告审核、签名活动、点击/关闭/举报事件。
- 保留无推荐对照组，监控任务完成率和关闭率。

### Phase 3：团队与商业化

- OAuth、团队私有 Registry、组织策略。
- 动态 Resolver 与活动服务。
- 安装归因、广告主后台和计费。

## 15. MVP 验收标准

1. 用户授权一个项目后，Runtime 无法写入该项目之外的任何路径。
2. 被篡改的 bundle 或 manifest 会被拒绝；被修改的 lockfile 会触发完整重新验证，且不能让未签名内容获得信任。
3. 云端不可用时，已安装且通过最后一次有效撤回列表检查的声明式 Skill 可以按策略继续加载，并显示撤回状态的新鲜度。
4. 首次安装前，用户能看到版本、发布者、文件和权限。
5. 安装失败不会留下半写入状态。
6. Skill 内容可以在同一任务中通过 `load_skill_context` 被 Agent 使用。
7. 不具备可信审批通道的宿主不能直接调用写入工具，只能降级到本地 CLI。

Phase 2 另外验收：关闭推荐后不再请求推荐；推荐服务故障不影响 Skill 解析、安装或任务完成。

## 16. 仍需产品决策

1. MVP 首个宿主选择 Codex、Claude 还是 Cursor。
2. 首版 Skill 是否只允许 Markdown，还是允许受限 WASM/脚本。
3. 免费模式是否默认开启合作推荐，还是首次明确选择后开启。
4. Registry 是完全公开，还是下载需要登录。
5. 发布者体系先由 SkillFlux 自营，还是首版就开放第三方提交。
6. Phase 0 的 10 个 Skill 选择标准、端到端成功指标和首个宿主测试矩阵。
7. 发布者信任根、密钥轮换与撤销是否直接采用 TUF 一类成熟更新框架。
8. 本地缓存容量、清理策略、并发项目锁和崩溃恢复语义。

## 17. 分发安全说明

正式发布时不应把未固定版本的 `npx -y skillflux install` 当作安全安装路径。至少应固定 Runtime 版本、禁用 lifecycle scripts，并提供签名产物和校验说明；更稳妥的方式是发布签名二进制或经过验证的包管理器制品。

## 18. 规范参考

- [MCP 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) 采用无会话的 HTTP 核心，并支持 MCP Apps 等扩展。
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) 用于模型可调用动作；结果可以包含受 schema 约束的 structured content。
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) 通过 `ui://` resource 在沙箱 iframe 中渲染交互界面。
- [SEP-2577](https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging) 已弃用 Roots；项目范围应使用工具参数、资源 URI、服务配置或环境配置。
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) 要求远程实现遵循 OAuth、PKCE、资源受众绑定等安全规则；采用 2026-07-28 时还应校验 issuer。
