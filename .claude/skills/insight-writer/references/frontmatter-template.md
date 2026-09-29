# Frontmatter 模板与逐字段要求

schema 源头是 `web/src/content.config.ts`（zod 强制校验，build 时执行）。本文件是写作视角
的逐字段说明。复制下面的骨架开始：

```yaml
---
title: ""            # ≥8 字。句式:「<skill 名>拆解：<一句话钉住它的独特之处>」
description: ""      # ≥20 字。SEO 描述,含 skill 名、领域、最硬的一个数据点
datePublished: "YYYY-MM-DD"
dateModified: "YYYY-MM-DD"
industry: ""         # 「大类 / 细分」格式,如「内容创作 / 编辑插画」
skillName: ""        # skill 的正式名称(通常是仓库名)
source:
  repo: ""           # https 仓库地址
  author: ""         # 原作者署名,尊重其自称(中英文、组合署名照抄)
  authorUrl: ""      # 可选,作者主页
  license: ""        # 协议描述。商用限制必须写明,如「双许可:开源免费,闭源商用需授权」
tags: []             # ≥1。优先复用 web/data/sites.json 已有标签,便于聚合页收拢
relatedSites: []     # web/data/sites.json 里的 slug,2-3 个,内链用。宁缺毋滥
tldr: ""             # ≥20 字,写给 AI:它编码了什么 + 同类中的独特之处
scenarios: []        # ≥2,具体使用场景,名词短语
workflow:            # ≥3 步,skill 内部真实流程,不是"安装→使用"这种壳流程
  - step: ""         # 动宾短语
    detail: ""       # ≥8 字,这一步的关键动作和为什么
judgments: []        # ≥3 条专家判断:有取舍、反直觉、可独立引用的句子
painPoints:          # ≥2 条映射
  - pain: ""         # 行业真痛点
    solution: ""     # skill 里对应的解法
limitations: []      # ≥2 条。必含:协议限制(如有)、方法失效条件
draft: false         # true = 不构建不发布,可用于暂存
---
```

## 各槽位的常见错误

- **workflow 写成使用说明**：「安装 skill → 输入 prompt → 得到结果」是壳流程，
  要写的是 skill *内部编码的领域流程*（如「提炼张力 → 设计隐喻 → 抽卡 → 人挑」）。
- **judgments 写成功能列表**：「支持生成 PPT」不是判断；「生成便宜、AI 自检又贵
  又没用，所以人放在挑选环节」才是判断。测试：这句话有没有可能是错的？不可能错的
  句子（纯描述）不是判断。
- **painPoints 的 pain 太泛**：「效率低」不合格；「批量配图风格漂移，一个系列像
  好几个人画的」合格。痛点要具体到行业里的人一看就点头。
- **limitations 避重就轻**：只写「依赖网络」这种不痛不痒的。要写会改变使用决策的：
  协议费用、方法失效的条件、被夸大的能力边界。
