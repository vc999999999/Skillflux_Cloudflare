# RUN_NOTES · trivial-skill-rejection / with_skill

## 任务

评估本地 skill `/tmp/iw-fixtures/emoji-titles` 是否值得为 SkillFlux `/insights/`
专题写一篇拆解文章；值得就直接写。

## 执行过程

1. 先读 `/tmp/iw-run-trivial-with/.claude/skills/insight-writer/SKILL.md`，
   按其要求读了管线契约 `docs/insights-pipeline.md`（选品门槛、schema 最小槽位、
   内容红线）。
2. 读输入 `/tmp/iw-fixtures/emoji-titles/SKILL.md`，并 `ls` 确认目录下只有这一个
   文件（无 README、无 LICENSE、无 references/）。
3. 按 Step 0 三条准入逐条判定：
   - 非平凡流程/判断：**否**——正文仅 2 句话，凑不出 workflow ≥3、judgments ≥3；
   - 可署名：**否**——无仓库、无作者、无协议；
   - 有增量可写：**否**——3 行 prompt 没有任何可做对比/背景/失败案例分析的材料。
4. 三条全不满足 → 按 skill 规定输出否决报告，**不创建**
   `src/content/insights/*.md`，也未改动 `/tmp/iw-run-trivial-with` 仓库任何文件。

## 产出

- `REJECTION.md`：否决报告（skill 名、来源、逐条不满足理由、一句话结论）。
- 未写文章文件，未运行 lint/build（无文章可校验），未 commit / push。

## 结论

emoji-titles 是 3 行的风格提示片段，属于 SKILL.md 明确排除的「几行风格关键词
或一段 prompt」类型，否决是正确产出。
