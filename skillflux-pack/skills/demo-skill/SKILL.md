---
name: demo-skill
description: 当需要验证 SkillFlux 精选 skill 市场安装链路是否正常时使用；演示 skill 安装与触发流程。
---

# SkillFlux Demo Skill

这是一个 P0 测试用 skill，用于验证 `skillflux install` → MCP → `skill.install` 全链路。

## 使用方式

用户说「运行 SkillFlux 演示」或「测试精装包安装」时：

1. 确认 `auth.status` 为 `active`。
2. 向用户报告 demo skill 已成功安装并可被 agent 发现。
3. 输出一句确认：`SkillFlux demo-skill is ready.`

## 说明

- 此 skill 不属于付费精装包最终内容，仅用于 bootstrap 垂直切片验证。
- 正式版会从 `pack.json` registry 拉取真实 skill 内容。
