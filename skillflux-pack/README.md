# SkillFlux Pack（精选 Skill 市场）

本目录实现 [docs/specs/skillflux-pack-design.md](../docs/specs/skillflux-pack-design.md) v0.3 中的 Bootstrap Kit 与 P0/P1 能力。

SkillFlux 是**官方 curated skill marketplace + npm installer + MCP package manager**，不是远程执行环境，也不是用户上传平台。

## 产品原则

```
Global bootstrap:
  skillflux CLI + skillflux mcp start
  skillflux-manager（全局）
  ~/.skillflux/config.json
  ~/.skillflux/cache/

Project usage:
  skillflux.json
  .skillflux/skills/<skill-id>/
  .skillflux/installed.json
```

## 快速开始

```bash
cd skillflux-pack
npm install
npm run build

# 全局 bootstrap（MCP + manager skill）
node dist/bin/skillflux.js install --agent cursor

# 诊断
node dist/bin/skillflux.js doctor
```

在 agent 内（fixture 模式）：

1. `auth.status` → active
2. `skill.install({ id: "demo-skill", scope: "project" })`
3. 检查 `./skillflux.json` 与 `./.skillflux/installed.json`

## CLI 命令

```bash
npx -y skillflux install
npx -y skillflux install --agent cursor --scope user
npx -y skillflux doctor
npx -y skillflux uninstall
skillflux mcp start    # MCP server（agent 通过此命令启动）
```

## MCP 工具

| 工具 | 用途 |
|---|---|
| `auth.start` / `auth.status` | 设备登录与授权状态 |
| `billing.checkout` | 托管支付链接 |
| `pack.search` / `pack.info` | 搜索与查看 catalog |
| `skill.install` | 按项目安装（默认 project scope） |
| `skill.update` | 更新（支持 `force` 覆盖本地修改） |
| `skill.list` / `skill.remove` | 列出/移除项目 skills |
| `doctor` | 诊断 bootstrap 与项目状态 |

工具返回结构化 JSON：

```json
{ "ok": true, "message": "...", "data": {} }
{ "ok": false, "code": "AUTH_REQUIRED", "message": "...", "nextAction": { "tool": "auth.start" } }
```

## MCP 注册

安装时写入稳定命令（经 `~/.skillflux/bin/skillflux` shim）：

```json
{
  "command": "~/.skillflux/bin/skillflux",
  "args": ["mcp", "start"]
}
```

## 目录结构

```
skillflux-pack/
├── bootstrap/skillflux-manager/
├── skills/demo-skill/
├── pack.json
├── src/cli/          # installer
├── src/mcp/          # MCP server + tools
└── src/lib/          # project manifest, lockfile, runtime
```

## 阶段

- **P0** ✅ Bootstrap + fixture demo-skill + 项目 scope 安装
- **P1** ✅ 结构化 tool 响应、`skillflux mcp start`、hash/atomic、冲突检测
- **P2** ✅ Registry API 骨架（`functions/api/`）
- **P3** SSO + 托管支付
- **P4** 多 agent 矩阵 + 从 `skillflux.json` 恢复
