---
name: user-story-writer
description: 当需要把需求拆成用户故事或验收标准（Given/When/Then）时触发。
---

# User Story Writer

## 步骤

1. 确认 persona 与目标。
2. 每个故事遵循：`As a <role>, I want <action>, so that <benefit>.`
3. 为每个 story 写 2–5 条验收标准（Given/When/Then）。
4. 标注优先级（P0/P1/P2）与依赖。

## 输出模板

```markdown
### US-001 [P0] 标题
**Story:** As a ..., I want ..., so that ...

**Acceptance Criteria:**
- Given ... When ... Then ...
```

## 约束

- 一个故事只描述一个可交付价值点。
- 避免实现细节；聚焦用户可感知行为。
