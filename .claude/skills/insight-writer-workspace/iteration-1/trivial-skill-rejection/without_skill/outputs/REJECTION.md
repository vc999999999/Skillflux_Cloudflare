# 否决报告：emoji-titles 不值得拆一篇 insights

**评估对象**：/tmp/iw-fixtures/emoji-titles（本地 skill，共 9 行）
**评估日期**：2026-07-03
**结论**：否决。不写。

## Skill 内容全文（除 frontmatter 外）

> When the user asks for a title, add 1-2 relevant emojis at the start.
> Pick emojis that match the topic. Keep it fun!

两句话，一个规则：给标题开头加 1–2 个相关 emoji。

## 否决理由

1. **没有可拆解的方法论。** insights 专题的价值在于把 skill 里编码的「专家经验」拆出来。
   emoji-titles 没有工作流、没有取舍、没有失败经验的反制、没有任何非显而易见的判断。
   「挑个跟主题相关的 emoji」是任何模型不装 skill 也会做的事。

2. **撑不起 content schema 的硬性字段。** `src/content.config.ts` 要求：
   - `workflow` ≥ 3 步（本 skill 只有一步：加 emoji）
   - `judgments` ≥ 3 条「别处抄不到的取舍」（一条都提炼不出来）
   - `painPoints` ≥ 2 组行业痛点→解法（「标题不够活泼」算不上行业痛点）
   - `limitations` ≥ 2 条（唯一的 limitation 是它本身太薄）
   硬写只能靠注水，产出的是凑数内容，伤害专题的信誉。

3. **署名三件套无法满足。** schema 要求 `source.repo` 为合法 URL、author、license 缺一不可。
   这是一个无仓库、无作者信息、无协议的本地 fixture，frontmatter 连编都编不出来
   （编造出处违反专题「拆解别人的作品必须给出处」的约定）。

4. **对比现有选品标准差距悬殊。** 已发布的 orange-line-illustration 一文拆的是：
   隐喻设计五步法、prompt 骨架复用、并行抽卡工作流、「人挑图 AI 不自检」的质检哲学。
   emoji-titles 与之同台，会显著拉低专题的选品水位。

## 如果作者想让它够格

- 编码真实的取舍：什么场合**不该**加 emoji（正式文档、error message、无障碍阅读器场景）
- emoji 与平台渲染差异、多语言语境的踩坑经验
- 从「加 emoji」升级为完整的标题打磨工作流（受众、平台、A/B 命名规范）

在那之前，这个 skill 属于「一句 prompt 就能替代」的类别，不进专题。
