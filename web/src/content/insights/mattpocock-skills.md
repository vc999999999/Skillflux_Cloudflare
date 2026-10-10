---
title: "Matt Pocock Skills 拆解：从需求追问、任务拆分到行为测试"
description: "基于已收录的 Matt Pocock Skills 固定快照，拆解 grill-me、grilling、to-spec、to-tickets 与 tdd 的分工，用导出功能示例说明需求澄清、纵向任务和行为测试如何衔接，以及使用前需要确认的边界。"
datePublished: "2026-10-10"
dateModified: "2026-10-10"
industry: "软件工程 / AI 协作开发"
skillName: "mattpocock/skills"
source:
  repo: "https://github.com/mattpocock/skills"
  author: "Matt Pocock"
  authorUrl: "https://github.com/mattpocock"
  license: "本文分析的 Skill 使用 MIT；复用时保留版权与许可声明。仓库 pr 目录另有第三方署名文件。"
tags: ["Agent Skills", "开源", "GitHub", "合集"]
relatedSites:
  - "github-com-mattpocock-skills"
tldr: "Matt Pocock Skills 用 grilling 澄清决策，以 to-spec 固化范围，以 to-tickets 拆出可单独验证的完整行为，再让 tdd 在约定的公开接口上逐步验证实现；各阶段交付什么，比一次加载多少 Skill 更重要。"
scenarios:
  - "需求还停留在一句想法，需要先明确用户、范围和取舍"
  - "已有规格，但开发任务按数据库、接口、页面分层，迟迟无法演示完整功能"
  - "测试随重构频繁破坏，需要重新确定可观察行为和验证入口"
workflow:
  - step: "按决策依赖分轮追问"
    detail: "grill-me 转交 grilling；grilling 将问题组织成决策树，每轮只提出前提已经确定的问题，给出建议并等待人的选择。"
  - step: "把讨论整理为规格"
    detail: "to-spec 综合现有讨论与代码上下文，记录用户故事、实现取舍、测试边界和范围外事项，并使用已配置的事项跟踪方式。"
  - step: "拆成可独立验证的任务"
    detail: "to-tickets 让每项任务贯穿必要的页面、接口和数据层，声明阻塞关系，再与用户确认粒度和依赖。"
  - step: "逐个行为实现与验证"
    detail: "implement 在预先约定的测试接口调用 tdd；一次先写一个失败测试，再完成足够通过的实现，最终进入代码审查。"
judgments:
  - "事实调查交给代理，产品决策交给用户；能从代码查明的问题不应重复消耗访谈时间。"
  - "一个问题依赖另一个尚未回答的问题时，应放到下一轮，避免在同一轮里夹带假设。"
  - "任务完成后应能单独演示或验证；只有某一层写完，通常还不能证明用户获得了能力。"
  - "测试断言应来自规格或独立算例，并从公开接口观察行为，避免照抄实现计算预期结果。"
painPoints:
  - pain: "需求访谈问题堆在一起，后面的问题默认了前面的答案"
    solution: "按决策依赖推进，只询问当前能做出的选择，并在下一轮重新计算待决事项"
  - pain: "任务都显示完成，但串起页面、接口和数据后才发现不匹配"
    solution: "先交付一条窄而完整的使用路径，再沿着已经验证的路径扩展"
  - pain: "代码内部结构一改，大量测试失效"
    solution: "预先约定测试的公开边界，用用户可观察结果定义断言"
limitations:
  - "需要人参与关键取舍；需求访谈的结束条件是形成共同理解，不能把沉默当作确认。"
  - "to-spec、to-tickets 等流程依赖项目的事项跟踪配置、领域术语和现有代码上下文，空项目需先补齐这些信息。"
  - "跨全库的机械重构有专门的分批迁移例外，不能强行套用普通功能的纵向切片。"
  - "本文解释已收录快照的设计，未执行这套工程链；完整收录的 38 个 Skill 不代表全部已获 SkillFlux MCP 安装资格。"
draft: false
---

## 一句“加个导出功能”会隐藏哪些决定

假设一个订单系统要增加 CSV 导出。产品负责人说“把当前结果导出来”，开发者仍需决定：导出当前页还是全部筛选结果？谁能导出？大数据量时直接下载还是生成后台任务？这些答案会改变后续设计。

`grilling` 的作用是把这些决定的依赖关系摆出来。先确定导出的对象和权限，再讨论等待方式，最后处理失败恢复，讨论才不会在假设上继续延伸。代码中已有的筛选规则应由代理调查；“是否允许导出全部结果”则需要人做选择。它也解释了为什么 `grill-me` 文件很短：该入口把工作交给共享的 `grilling`，完整能力需要连同依赖一起读取。

这里的取舍是沟通成本。一个文案修正通常不值得展开完整访谈；涉及数据权限和长任务的需求，提前问清楚能减少后续返工。判断是否需要访谈，应看尚未确定的决定会改变多少实现。

## 规格和任务分别解决什么

在这个固定快照里，相关入口叫 `to-spec` 和 `to-tickets`。`to-spec` 汇总已经讨论过的内容，重点是问题、用户故事、实现决定、测试决定和范围外事项。它仍会确认测试边界，但不会重新开启一轮完整需求访谈。这样留下的规格可以帮助之后的执行者理解“为什么这样做”。

`to-tickets` 接着回答“先完成哪一段”。以上面的示例来说，第一项可以是“有权限的用户导出一个小结果集，并验证内容与筛选一致”，第二项再增加大结果集的异步处理。每项都包含所需的数据、接口、页面和测试，完成后能展示一个用户行为。相比“先写完所有接口，再写所有页面”，这种安排会更早暴露层与层之间的不一致。

它也有例外：全库字段迁移可能必须先让新旧结构并存，再逐批迁移调用方，最后删除旧结构。原文单独保留了这条路径，使用者应根据改动性质选择任务组织方式。

## TDD 怎样检验这份约定

进入 `tdd` 前，先约定从哪里观察结果。例如通过导出入口得到 CSV，检查指定订单和列名，比检查内部函数是否被调用更贴近用户需求。预期值应来自已知订单样例和导出规则；若测试复制了实现的过滤算法，两边可能一起犯错。

该快照要求一次推进一个行为：先看到测试失败，再做最小实现。它还明确把重构放到审查阶段。`implement` 最后接入 `code-review`，分别检查仓库规范与需求符合度。这样可以发现两种不同问题：代码符合规范但漏了权限要求，或者功能齐了却违反项目约定。

对维护现有项目的人，最可迁移的是阶段之间的交接：访谈交付已确认的决定，规格交付范围，任务交付验证目标，测试交付可重复检查的行为。一次加载全部 Skill 会增加上下文；按当前缺口选择入口更容易判断下一步是否完成。

## 阅读版本与使用边界

本文依据 SkillFlux 已完整收录的提交 `b0618bc436ad893b3c5e84e55fba86586d34a404`，是源码分析与示例设计，没有运行上述订单案例。完整收录保留了引用文件、脚本和许可证；MCP 安装资格仍按具体包版本审核。已有的 `grill-me`、`grilling` 1.0.0 与这里的后续快照需要分别看待。

核对原文可从 [grilling](https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/productivity/grilling/SKILL.md)、[to-spec](https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/to-spec/SKILL.md)、[to-tickets](https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/to-tickets/SKILL.md) 和 [tdd](https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/tdd/SKILL.md) 开始；[资源详情](/resource/mattpocock-skills/)列出了完整收录范围。
