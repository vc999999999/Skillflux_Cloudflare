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

详见 [CONTRACT.md](CONTRACT.md)（目录格式、信任模型与 Runtime 边界）与[根 README](../README.md)（完整命令）。
