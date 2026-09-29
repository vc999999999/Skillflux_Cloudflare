---
name: insight-writer
description: >
  为 SkillFlux 的「Skill 拆解」专题（/insights/）撰写深度拆解文章。输入一个 agent skill
  的 GitHub 仓库地址或本地路径，产出一篇通过 web/src/content.config.ts schema 校验的
  web/src/content/insights/<slug>.md。凡用户要求「拆解某个 skill」「给 insights 专题写文章」
  「分析这个 skill 仓库」「写一篇 skill 深度分析发到网站」，或者贴出一个 skill 仓库链接
  让写内容时，务必使用本 skill——即使没有出现"拆解"二字。本 skill 也负责选品判断：
  不够格的 skill 输出否决报告而不是硬写一篇。
---

# Insight Writer · Skill 拆解写作

把一个 agent skill 拆成「行业痛点 → 编码的经验流程 → 专家判断 → 局限」的深度文章。
产出的不是摘要，是增量分析——每篇必须回答：**读这篇比直接读原 skill 多得到什么？**

管线契约（红线、发布流程、熔断策略）见仓库 `docs/insights-pipeline.md`，动笔前先读一遍。

## Step 0 — 选品门槛（先判断，再动笔）

不是每个 skill 都值得拆。三条准入，全部满足才继续：

1. **有非平凡的流程或判断逻辑。** 拆不出 ≥3 步真实工作流、≥3 条专家判断的 skill
   不拆——几行风格关键词或一段 prompt 的不算。schema 的最小数量就是这道门槛的机器化
   表达：凑不满槽位，build 会直接失败，所以不要硬凑。
2. **可署名。** 找得到原仓库、原作者、协议。协议不明的跳过。
3. **有增量可写。** 想不出任何一条「原文没有明说的东西」（对比、背景、失败案例解读、
   可迁移模式、局限分析），就说明只能写复述，复述不发。

任何一条不满足：**输出否决报告**（skill 名、仓库、不满足哪条、一句话理由），不创建
文章文件。否决也是有价值的产出——它防止专题被凑数文稀释。

## Step 1 — 源材料采集

- 优先 `git clone --depth 1`；**国内网络对 GitHub 直连经常超时**，clone 卡住就换
  `gh api repos/<owner>/<repo>/contents/<path> --jq '.content' | base64 -d` 逐文件拉取。
- 必读：SKILL.md、README、LICENSE、`references/` 下所有文档。
- 用 `gh api repos/<owner>/<repo>` 记录：star 数、创建时间、最近推送、协议、描述。
  star 增速（created_at 到今天）是文章里最硬的一个数据点。
- 查 `web/data/sites.json` 里有没有相关收录站（同作者、同领域、同类型），选 2–3 个
  slug 填进 `relatedSites` 做内链。

## Step 2 — 三层提取

读源材料时按三层归类记录，这决定文章的骨架：

1. **决策铁律**——skill 里「不可协商」的部分。注意原文的措辞方式：好 skill 会把铁律
   写成判断句（"如果处处是橙色，就没有橙色"），这些句子本身就是可引用的精华。
2. **方法论流程**——skill 教使用者按什么顺序做什么。这层填 `workflow` 槽位。
3. **实测经验与失败案例**——「什么不行、为什么不行」、反制短语、踩坑记录。这层最
   稀缺，是文章增量的主要来源：大多数读者读原文时会跳过失败案例，你的工作是把它们
   放到聚光灯下。

## Step 3 — 填结构化槽位

frontmatter 完整模板和逐字段要求见 `references/frontmatter-template.md`。最小数量
（schema 强制）：scenarios ≥2、workflow ≥3、judgments ≥3、painPoints ≥2、limitations ≥2。

- `judgments` 只收「专家判断」：有取舍、有反直觉、能独立成立的句子。操作步骤不算。
- `painPoints` 是映射不是罗列：每条必须是「行业的真痛点 → skill 里对应的解法」。
- `limitations` 至少要包含协议限制（如有）和「这套方法在什么条件下不成立」。
- `tldr` 会进 llms.txt 和 RSS，写给 AI 读：一句话说清这个 skill 编码了什么、
  它在同类里的独特之处。

## Step 4 — 深度解读正文（增量部分）

正文是 markdown body，只写原文之外的东西。合法的增量类型：

- **跨 skill / 跨方法对比**：它和同类的差别在哪（"大部分图像类 skill 是一包风格
  关键词，这个编码的是方法论"）。
- **行业背景**：这个 skill 踩中了什么行业情绪或真实事件。
- **失败案例解读**：原文记录的失败为什么值钱。
- **经济学 / 机制分析**：某条反直觉的流程判断背后的成本结构。
- **可迁移元模式**：抽掉领域后仍然成立的结构，写给想做别的领域 skill 的人。

写 3–5 个 `##` 小节，总量 800 字以上。每写完一节自问：这段话删掉领域名词后是不是
放之四海皆准的空话？是就重写——增量必须具体到这个 skill 才成立。

## Step 5 — 风格与合规

风格细则和正反例见 `references/style-guide.md`。最重要的几条：

- 开头直接进最有信息量的事实，禁止「随着…」「在…的今天」式铺垫。
- 判断句优先于描述句；每个判断要有数据或原文证据支撑。
- 引用原文短句可以（用引号），整段搬运不行——页面已有「分析评论、不转载全文」声明，
  文章必须配得上这句话。
- `source` 三件套（repo/author/license）如实填写，协议里的商用限制必须写进
  limitations，这是对原作者的保护也是对读者的提醒。

## Step 6 — 落盘与验证

1. 写入 `web/src/content/insights/<repo-name>.md`（kebab-case，文件名即 URL）。
2. 快速自检：`node .claude/skills/insight-writer/scripts/lint-insight.mjs web/src/content/insights/<slug>.md`
   （检查禁用句式、槽位数量、署名完整性、正文长度）。
3. 最终校验：`npm run build`——schema 不过会在这里失败，失败信息会指出具体字段。
4. 提交为独立 PR（一篇一个 PR），等人工 review。不要直接 merge：人审是管线的
   质量门槛，跳过它整个专题的防惩罚设计就失效了。
