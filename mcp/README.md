# @skillflux/mcp

SkillFlux 的独立 npm 包：本地 stdio MCP、命令行工具以及 Registry HTTP 服务。

需要 Node.js >=22.13。仓库开发：

```bash
npm install
npm run build
node dist/cli.js --help
node dist/cli.js registry --dev
```

生产 Registry 请去掉 `--dev`。开发 seed 也只进入待审队列，不自动批准。源码仓库的 `mcp/.env.example` 列出环境变量；环境文件需显式加载，未随 npm 包分发。无运营 token 时管理端点不可访问；公共搜索和下载不需要账号。SQLite、签名密钥、评测及广告账本在 `SKILLFLUX_DATA_DIR` 指定的持久目录。

项目接入：

```bash
skillflux init --project /absolute/path/to/project --registry https://registry.example --host codex
```

它生成项目配置与显性调用的 SkillFlux Bootstrap Skill，并固定 Registry 公钥。宿主重新载入配置后显性使用 `$skillflux`。安装包通过 Ed25519 签名和逐文件 SHA-256 验证，锁定精确版本；当前轮通过 MCP 返回指令内容，不依赖新文件被宿主自动发现。

| host | 项目 MCP 配置 | 显式 Bootstrap |
| --- | --- | --- |
| codex | `.codex/config.toml` | `.agents/skills/skillflux` |
| claude | `.mcp.json` | `.claude/skills/skillflux` |
| cursor | `.cursor/mcp.json` | `.cursor/skills/skillflux` |
| generic | `.mcp.json` | `.skillflux/bootstrap/skillflux` |

Codex 的元数据关闭隐式调用，Claude/Cursor 使用 `disable-model-invocation: true`，generic 需宿主手动读取 Bootstrap。各宿主还需启用/重新加载 MCP；文件生成验证不等同所有真实宿主版本通过端到端测试。MCP 初次安装需要初始化时明确 `--preauthorize-reviewed-text`，未授权时用 CLI 安装；升级仍须独立确认精确计划。

只有 CLI managed output 能直接控制最终追加广告。原生 MCP 不具备修改其他产品最终回答的权限。所有广告明确披露；原始 prompt、源码和最终答案不会作为广告 API 参数。

更新检查不会安装或更改版本：`skillflux check-updates`（别名 `outdated`）强制刷新，`--cached` 使用最长 24 小时的普通版本缓存。显式 `load` 附带轻量检查结果，安全撤销源独立检查。报告包含当前版本、最新及最新兼容版本、变更摘要、破坏性变更、固定策略、检查时间和缓存来源。离线缓存不会被表述为「已是最新」。这里检查的是项目技能发布版本；npm 包本身的升级由用户的包管理器管理。

`skillflux pin SKILL_ID` 固定当前版本，`unpin` 解除；依赖更新和回滚同样尊重固定策略。`skillflux update` 不带精确目标时只检查。选择目标后运行 `skillflux update SKILL_ID@VERSION` 查看计划并在终端确认；非交互执行须显式传 `--yes`，或先 `skillflux plan SKILL_ID --version VERSION` 再 `skillflux update --plan PLAN_ID --yes`。MCP 的 `skillflux.check_updates` 只读；`skillflux.update` 只接受用户已明确批准的固定 `planId`，初始安装预授权不能代替升级授权。计划绑定锁版本，锁变化、固定策略、修改过的本地文件、撤销或客户端不兼容会阻止升级；失败不切换当前锁。

广告默认上下文为 `unknown`，不会投放。已明确分类的普通任务可使用 `run --ad-context normal`，敏感或未知任务仍跳过；广告服务失败不会生成本地替代广告。JSON 模式将广告放在独立字段，普通 MCP 只返回独立结构化推荐且不保证宿主展示，也不因此上报曝光。

历史已公开包可以在原版本补测并重新获得资格，无需重写原签名包或改变 digest。Runtime 对 `/v1/qualifications/:digest` 返回的独立签名证明核对包 id、版本、digest、内容 hash、全部宿主评测和时效，将其单独存为 `.skillflux-qualification.json`。计划、安装、加载与回滚均复核资格，加载另行检查撤销；本地证明篡改或跨版本替换会在联网刷新前被拒绝。离线加载仅接受此前验证过的对应证明并披露缓存状态；离线不能新装、升级或回滚。已知撤销或失去资格不会被旧缓存覆盖。

源码仓库中的 `mcp/CONTRACT.md` 描述 API 模型和安全边界，`docs/operations.md` 说明评测、静态网站同步及备份。公共网站使用签名 snapshot，批准或撤销后需要同步、重建、部署，不能把旧静态页面当作当前安装资格。

维护工具随编译产物提供：`node dist/registry/maintenance.js backup DATA_DIR NEW_BACKUP_DIR`、`check BACKUP_DIR EXPECTED_KEY_ID`、`restore BACKUP_DIR NEW_DATA_DIR EXPECTED_KEY_ID`。备份包含明文私钥和完整业务数据，必须额外加密、限制访问；恢复只写新目录。

此仓库支持 `npm pack` 生成可安装 tarball，本次工作没有向 npm 发布。包版本变化由包管理器处理，技能版本通过上述 Runtime 计划管理。源码开发时 `npm test` 运行 HTTP、本地 Runtime 和协议测试。
