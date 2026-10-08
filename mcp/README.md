# @skillflux/mcp

SkillFlux 的独立 npm 包：本地 stdio MCP、命令行工具以及 GitHub 目录仓库构建器。

需要 Node.js >=22.13。仓库开发：

```bash
npm install
npm run build
node dist/cli.js --help
```

技能内容来自 GitHub 目录仓库（默认 `vc999999999/skillflux-catalog`）。客户端把默认分支解析为 commit SHA，所有下载都走该 SHA 的 raw 地址并逐文件验证 SHA-256；搜索在本机缓存的目录索引上进行，检索词不出本机。

目录仓库工具：

```bash
skillflux catalog /path/to/catalog-repo            # 扫描 + 生成 index.json
skillflux catalog /path/to/catalog-repo --check    # CI 一致性检查
```

开发种子可用 `node scripts/convert-seed.mjs <dir> --index` 转换为目录仓库结构（自带 simulation 证据，不能 qualified）。

项目接入：

```bash
skillflux init --project /absolute/path/to/project --repo vc999999999/skillflux-catalog [--source https://mirror.example] --host codex
```

它生成项目配置与显性调用的 SkillFlux Bootstrap Skill，并固定目录仓库身份。宿主重新载入配置后显性使用 `$skillflux`。安装包逐文件验证 SHA-256 并锁定精确版本；当前轮通过 MCP 返回指令内容，不依赖新文件被宿主自动发现。

| host | 项目 MCP 配置 | 显式 Bootstrap |
| --- | --- | --- |
| `codex` | `.codex/config.toml` | `.agents/skills/skillflux/` |
| `claude` | `.mcp.json` | `.claude/skills/skillflux/` |
| `cursor` | `.cursor/mcp.json` | `.cursor/skills/skillflux/` |
| `generic` | `.mcp.json` | `.skillflux/bootstrap/skillflux/` |

### 自动跟随技能内容更新

初始化默认使用 `manual`，保留逐次确认升级的行为。用户可通过 `init --update-policy follow-compatible` 一次开启，或在已有项目运行：

```bash
skillflux update-policy follow-compatible --project /absolute/path/to/project
skillflux update-policy --project /absolute/path/to/project         # 查看策略
skillflux update-policy manual --project /absolute/path/to/project  # 关闭自动跟随
```

开启后，CLI / MCP 的 `load` 在返回正文前同步已审核、稳定、兼容且无破坏性变化的版本，包括正文、参考资料、模板和经过校验的依赖。仅跟随同一 major；`0.x` 仅跟随同一 minor 的补丁。自动更新使用精确计划、逐文件哈希校验和事务切换，返回 `autoUpdate` 的模式、状态、版本变化及阻止原因。

固定版本、本地修改、跨越破坏性版本、权限、发布者或维护者变化以及依赖冲突会阻止自动更新。离线时返回通过本地完整性校验的旧内容并标记 `unknown`；已知撤销或本地篡改仍阻止加载。开启跟随时，回滚后会固定恢复的版本，解除固定后才继续跟随。

`--preauthorize-reviewed-text` 只控制 MCP 首次安装，与自动更新策略独立。MCP 不提供修改持久更新策略的工具；手动 `skillflux.update` 仍要求用户批准精确计划。

自动跟随只更新技能内容，不更新 npm/MCP 程序。旧用户需先安装新 npm 包，再按原仓库和宿主重新运行 `init` 同步入口、重启 MCP，并开启跟随策略。没有常驻后台同步；更新在下次联网加载时生效。

详见 [CONTRACT.md](CONTRACT.md)（目录格式、信任模型与 Runtime 边界）与[根 README](../README.md)（完整命令）。
