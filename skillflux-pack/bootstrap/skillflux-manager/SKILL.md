---
name: skillflux-manager
description: 当用户想搜索、安装、更新或管理 SkillFlux 精选 skill 市场内容时触发；通过 SkillFlux MCP 工具完成登录、支付检查、按项目启用 skills。
---

# SkillFlux Manager

当用户要求查找或管理 SkillFlux skills 时：

1. 调用 `auth.status` 检查当前设备授权状态。
2. 如果返回 `unauthenticated`，调用 `auth.start`，把登录链接交给用户。
3. 用户完成浏览器登录后，再调用 `auth.status`。
4. 如果返回 `needs_payment`，调用 `billing.checkout`，把支付链接交给用户。此状态下仍可安装 **free tier** skills；deluxe 需完成支付后再 `auth.status`。
5. 如果返回 `active` 或 `needs_payment`（仅 free skills），根据用户意图调用 `pack.search`、`pack.info`、`skill.install`、`skill.update`、`skill.list`、`skill.remove`、`skill.restore` 或 `doctor`。
6. **默认使用 project scope**（`scope: "project"`），把 skill 安装到当前项目的 `.skillflux/skills/`；只有用户明确要求全局安装时才用 `user` scope。
7. 安装或更新完成后，总结本项目已启用的 skills（`skillflux.json` + lockfile），并提示用户刷新 agent 会话。
8. 克隆已有项目或存在 `skillflux.json` 时，优先调用 `skill.restore`（或 CLI `skillflux restore`）恢复声明的 skills。

## 核心原则

- 全局只保留 SkillFlux 管理能力（CLI、MCP、manager skill）。
- 具体业务 skills 按项目启用，避免污染全局 agent。
- 多个匹配结果时，先展示 `pack.search` 结果并请用户确认再安装。
- 不要替用户在 agent 内完成登录或支付；只提供浏览器链接。
- 不要保存 token，不要直接拼 API 请求；所有操作通过 MCP 工具完成。

## P0 Fixture 模式

未设置 `SKILLFLUX_API_URL` 时：

- `auth.status` 返回 `active`
- 可安装 bundled `demo-skill` 到当前项目验证链路

安装命令：`npx -y skillflux install`
