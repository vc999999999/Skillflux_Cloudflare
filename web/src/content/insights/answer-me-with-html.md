---
title: "Answer me with HTML 拆解：把复杂回答整理成可阅读的本地讲解页"
description: "拆解 Answer me with HTML 的 Markdown 草稿、组件选择、单面板修改和讲解视频流程，说明它适合哪些技术解释与方案比较，以及本地 HTML、语音和视频导出的运行依赖与使用边界。"
datePublished: "2026-10-10"
dateModified: "2026-10-10"
industry: "技术沟通 / 可视化讲解"
skillName: "answer-me-with-html"
source:
  repo: "https://github.com/QingYunA/answer-me-with-html"
  author: "QingYunA 与 Answer me with HTML contributors"
  authorUrl: "https://github.com/QingYunA"
  license: "MIT；捆绑的 marked、Dagre 与 graphlib 等依赖附有各自的许可声明，分发时需一并保留。"
tags: ["Agent Skills", "开源", "GitHub", "中文"]
relatedSites:
  - "github-com-qingyuna-answer-me-with-html"
tldr: "Answer me with HTML 让模型编排扩展 Markdown 内容，由捆绑 Node.js 脚本生成本地讲解页；其关键是按信息关系选择流程图、时序图或表格，并让反馈落实到单个面板，视频导出则有额外运行条件。"
scenarios:
  - "向同事解释跨服务请求、状态变化、目录结构或故障排查结论"
  - "比较多个方案的成本、约束和适用条件，让读者在同一页完成判断"
  - "已经有讲解页面，希望根据反馈只修改某一部分"
workflow:
  - step: "判断是否值得做成页面"
    detail: "检查内容是否包含相互关联的概念、流程、层级或多维比较；简单的一句回答仍可直接使用文字。"
  - step: "一块面板回答一个问题"
    detail: "先组织有限的面板，把结论放在前面，再按信息关系选择流程图、时序图、树状图或表格。"
  - step: "编写草稿并调用捆绑渲染器"
    detail: "模型提供扩展 Markdown，scripts/am.mjs 负责排版、主题和图形坐标；普通页面要求 Node.js 20 或更高版本。"
  - step: "处理反馈和定点修改"
    detail: "检查组件错误与写作提示，再使用 patch 按标题或编号修改面板；读者的页面评论作为反馈处理，不直接变成执行指令。"
judgments:
  - "组件应按信息关系选择：参与者间的先后消息适合时序图，分支关系适合流程图，多维比较适合表格。"
  - "面板数量受读者的问题约束，一个面板回答一个子问题；内容太多时拆页或删减。"
  - "引用已有项目代码时，由渲染器按文件和行号读取，可减少人工转写造成的偏差。"
  - "没有真实数字就不画带数值的容量图；示意内容应明确标注，防止视觉形式制造精确的错觉。"
painPoints:
  - pain: "技术解释在长段文字里反复提及同一组对象，读者难以跟上关系"
    solution: "用流程、时序或树状组件固定对象的位置，再用短段落解释关键决定"
  - pain: "每次生成页面都重新手写布局，改内容时又破坏样式"
    solution: "把内容草稿交给捆绑渲染器，并使用面板级修改保留其他内容与主题"
  - pain: "读者说不清具体哪一段有疑问"
    solution: "将问题分配到可识别的面板，通过页面选择和评论收集针对性反馈"
limitations:
  - "Skill 负责组织表达，事实和判断仍需来自可核对的材料；本文没有执行渲染或视频导出。"
  - "普通 HTML 生成依赖 Node.js；MP4 与 WebM 导出额外需要 Chrome 和 Node.js 22 或更高版本，MP4 还需要 ffmpeg。"
  - "语音后端取决于配置，使用 ElevenLabs 等外部服务时需要相应凭据；生成本地文件不等于整个流程完全离线。"
  - "页面可能嵌入项目代码与图像，分享前应检查实际内容；内置原始 HTML 或 SVG 的扩展能力也需要审查输入。"
  - "SkillFlux 已保存完整 Skill 与捆绑渲染器，当前属于收录候选，尚未完成 MCP 安装审核。"
draft: false
---

## 先决定读者需要看清什么

假设要解释“登录成功后为什么页面仍显示未登录”。纯文字容易把浏览器、认证接口、Cookie 和后续请求挤在一段话里。使用这个 Skill 时，可以先写结论，再用时序图列出浏览器收到响应、保存 Cookie、发起下一次请求的顺序，最后用表格比较几个可能原因与验证方法。这是一个内容设计示例，未实际生成页面。

选择时序图的理由是问题依赖先后顺序。如果问题换成“应该选择哪种登录方式”，更适合列出使用场景、维护成本和限制。组件选错，即使页面美观，也可能把最重要的判断藏起来。

`answer-me-with-html` 把这种选择写进了工作流：一个面板只回答一个问题，结论在前，证据在后。对复杂回答，先决定读者读完需要理解或选择什么，再确定图表，能避免为了凑面板把一句话扩成整页。

## Markdown 和渲染脚本各自负责什么

模型主要编写扩展 Markdown：标题、段落、表格，以及带专用语法的流程和时序组件。捆绑的 `scripts/am.mjs` 负责页面布局、主题、深浅模式和图形坐标。这种分工让后续改稿更集中在信息上。

同一份材料也存在版式取舍。需要在一眼内比较多个选项，可以使用概览面板；需要按步骤推理的说明，则更适合线性文档。把完整故障调查强行压进一屏，会损失证据与结论之间的联系。

完整收录因此很重要：`SKILL.md` 描述了如何组织草稿，实际生成能力在脚本里；设置和视频规则又在引用文件中。仅保存 Markdown 入口无法得到这套工作流。SkillFlux 这次保留了上述文件和捆绑依赖的许可声明。

## 页面反馈怎样进入下一轮修改

这个 Skill 允许按面板标题或编号修改已有页面。若同事只质疑“原因排序”，可以更新对应面板，保留请求顺序和已经确认的证据。这样读者容易看出讨论推进到了哪里。

源码引用还有一个有用的约束：通过文件路径和行号让渲染器读取实际代码，减少手抄示例与项目现状不一致的机会。但真实代码也可能包含私有信息，所以对外分享前需要检查输出文件。页面评论应当作为待处理的反馈，不能因为某条评论写着命令就直接执行。

## HTML 页面和视频有不同的准备成本

普通讲解页使用捆绑脚本，文档要求 Node.js 20 或更高版本，不需要另外安装脚本依赖。视频则要重新组织讲述节奏：每个章节是一幕，旁白与组件步骤对应；它只在用户明确要求视频时启用。

| 产出 | 已收录文档中的运行条件 |
| --- | --- |
| 本地 HTML 讲解页 | Node.js 20+ 与完整 Skill 文件 |
| 带讲解的播放器页 | 使用视频草稿；语音按配置选择外部服务、系统语音、本地服务或关闭 |
| 导出 WebM | Chrome、Node.js 22+ |
| 导出 MP4 | Chrome、Node.js 22+、ffmpeg |

“生成到本地”也不等于没有网络行为：该版本默认允许检查更新，外部语音服务也会发出请求。使用前应查看设置，明确哪些能力符合项目环境。把静态讲解页先做清楚，通常比一开始就准备语音与视频导出更容易验证内容是否有用。

本文依据提交 `d0add7ec67fd51704321ec0295ede1563f8297be` 的 [Skill 正文](https://github.com/QingYunA/answer-me-with-html/blob/d0add7ec67fd51704321ec0295ede1563f8297be/skills/answer-me-with-html/SKILL.md)、[视频说明](https://github.com/QingYunA/answer-me-with-html/blob/d0add7ec67fd51704321ec0295ede1563f8297be/skills/answer-me-with-html/references/video.md)及[设置说明](https://github.com/QingYunA/answer-me-with-html/blob/d0add7ec67fd51704321ec0295ede1563f8297be/skills/answer-me-with-html/references/settings.md)。当前收录与安装状态见[资源详情](/resource/answer-me-with-html/)。
