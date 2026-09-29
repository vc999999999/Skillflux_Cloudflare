# Skill 拆解专题 · 数据管线约定

本文档是「爬虫 + skill 分析工作流」与网站之间的契约。管线只需要产出一个
markdown 文件并提交 PR，网站负责渲染、RSS、llms.txt、sitemap 和 JSON-LD。

## 产出物

每篇拆解 = 一个文件：

```
web/src/content/insights/<slug>.md
```

- `<slug>` 用被拆解 skill 的仓库名（kebab-case），如 `orange-line-illustration`。
- 文件名即 URL：`/insights/<slug>/`。
- schema 由 `web/src/content.config.ts` 强制校验，`npm run build` 不通过就无法上线。

## Frontmatter schema

```yaml
title: string            # ≥8 字，禁止「随着…」式套话开头
description: string      # ≥20 字，SEO 描述
datePublished: "YYYY-MM-DD"
dateModified: "YYYY-MM-DD"
industry: string         # 行业/领域，如「内容创作 / 编辑插画」
skillName: string        # skill 的正式名称
source:                  # 署名三件套，缺一不可
  repo: url              # 原始仓库
  author: string         # 原作者署名
  authorUrl: url         # 可选
  license: string        # 协议描述，商用限制必须写明
tags: [string]           # ≥1，尽量复用 web/data/sites.json 已有标签
relatedSites: [string]   # web/data/sites.json 里的 slug，用于内链（可空）
tldr: string             # ≥20 字，给 AI 的一句话，进 llms.txt 和 RSS
scenarios: [string]      # ≥2 适用场景
workflow:                # ≥3 步，skill 内部真实的经验流程
  - step: string
    detail: string
judgments: [string]      # ≥3 条编码的专家判断（skill 的「精华」）
painPoints:              # ≥2 条行业痛点 → 解法映射
  - pain: string
    solution: string
limitations: [string]    # ≥2 条局限与边界
draft: boolean           # true 时不构建、不进 RSS/llms.txt
```

正文（markdown body）= 「深度解读」章节，写增量分析，不复述原文。

## 选品门槛（管线里的准入判断）

一个 skill 进入分析队列前必须全部满足：

1. **有非平凡的流程或判断逻辑**——凑不满 3 步 workflow、3 条 judgments
   的 skill 不拆（几行 prompt 的不算）。schema 的最小数量就是这道门槛的
   机器化表达：拆不出槽位 → build 失败 → 天然不能发。
2. **可署名**——找得到原仓库、原作者、协议。协议不明的跳过。
3. **有增量可写**——正文必须回答「读这篇比直接读原 skill 多得到什么」。
   合法增量：跨 skill 对比、行业背景、失败案例解读、可迁移元模式、
   局限分析。纯换措辞的摘要不算增量。

## 内容红线（防规模化内容惩罚）

1. **变化来自数据不来自措辞**：每篇的独特性必须来自被拆解对象本身。
   禁止固定开头/结尾套话（「随着 AI 的快速发展…」「未来可期…」）。
2. **发布走 PR**：管线产出 PR，人工 review 后 merge 才上线。检查两件事：
   事实对不对（署名、协议、数据）、有没有生成蠢话。
3. **控制 URL 增速**：每周新增 ≤1–2 篇。宁可停更一周，不发凑数文。
4. **不全文转载**：引用原 skill 片段可以，整段搬运不行。页面已内置
   署名区块和「分析评论、不转载全文」声明。

## 发布流程

```
爬虫扫描集合站/GitHub → 候选 skill 列表
  → 选品门槛过滤
  → skill 分析工作流产出 web/src/content/insights/<slug>.md
  → 开 PR（一篇一个 PR）
  → 人工 review + merge
  → CI 构建部署（schema 校验失败会挡在 build 阶段）
```

## 网站侧自动发生的事（管线不用管）

- `/insights/` 索引页（zh/en）自动收录新文章
- `/insights/feed.xml` 专题 RSS 自动更新
- `/llms.txt` 的 Skill Deep-dives 段自动追加（title + tldr + url）
- sitemap 自动包含新 URL
- `relatedSites` 渲染为目录内链卡片
- TechArticle + BreadcrumbList JSON-LD 自动生成，`isBasedOn` 指向原仓库

## 熔断

Search Console 观察全站 impressions。若整站曲线异常下跌，第一步是暂停
新增文章并评估，必要时对专题文章页加 noindex（保留页面与 RSS）。
