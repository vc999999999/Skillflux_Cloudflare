---
name: commit-message-zh
description: 当用户要编写或优化 Git commit message（中文或中英混合）时触发。
---

# Commit Message 中文规范

## 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

## type 词表

- feat: 新功能
- fix: 修复
- docs: 文档
- refactor: 重构
- test: 测试
- chore: 构建/工具

## 步骤

1. 阅读 diff 或用户描述，识别主要变更类型。
2. subject 用祈使句，≤50 字，不加句号。
3. body 说明 why，不是 what 的重复。
4. 破坏性变更在 footer 写 `BREAKING CHANGE:`。

## 示例

```
feat(skillflux): 支持项目级 skill 安装

默认写入 .skillflux/skills，并更新 skillflux.json。
```
