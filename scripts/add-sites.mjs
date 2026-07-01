// One-off: append newly submitted sites to data/sites.json.
// Content grounded in fetched site info (or known project facts); no fabricated metrics.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../data/sites.json", import.meta.url));
const sites = JSON.parse(readFileSync(path, "utf8"));
const TODAY = "2026-07-01";

const additions = [
  {
    id: "skill0-io",
    slug: "skill0-io",
    name: "skill0",
    canonicalUrl: "https://skill0.io/",
    displayUrl: "skill0.io",
    tags: ["Agent Skills", "合集"],
    category: "marketplace",
    language: ["en"],
    region: "global",
    type: "skill 合集",
    scale: "集合入口",
    pricing: "free",
    tagline: "社区驱动的 skill 市场",
    summary: "skill0 是一个社区驱动的英文 skill 市场,收录大量用于扩展 Claude 能力的 agent skill。",
    longSummary:
      "skill0 是一个社区驱动的英文 skill 市场,把社区贡献的 agent skill 集中呈现,主题覆盖 AI 产品增长、文档、设计、安全等多个方向,并为 Claude Code 用户提供接入说明。\n\n作为市场类来源,它的价值在于覆盖面和社区活跃度,免费使用。在 SkillFlux 中它归入市场类,可信度中等,适合想在社区生态里发现和取用 Claude skill 的英文用户。",
    aiSummary: "适合浏览社区贡献的 Claude skill 市场,按主题发现能力。",
    faqs: [
      { q: "skill0 是什么?", a: "一个社区驱动的英文 skill 市场,集中呈现扩展 Claude 能力的 agent skill,并提供接入说明。" },
      { q: "skill0 收费吗?", a: "免费。" }
    ],
    featured: false,
    recommended: false,
    trustLevel: "medium",
    status: "active",
    sourceUrls: ["https://skill0.io/"],
    addedAt: TODAY,
    updatedAt: TODAY
  },
  {
    id: "qoder-community-pages-dev-zh-skills",
    slug: "qoder-community-pages-dev-zh-skills",
    name: "Qoder Community Skills",
    canonicalUrl: "https://qoder-community.pages.dev/zh/skills/",
    displayUrl: "qoder-community.pages.dev/zh/skills",
    tags: ["Agent Skills", "合集", "Qoder", "中文"],
    category: "community",
    language: ["zh", "en"],
    region: "cn",
    type: "skill 合集",
    scale: "合集",
    pricing: "free",
    tagline: "Qoder 社区 skill 合集",
    summary: "Qoder 社区维护的 skill 合集,聚合 skills.sh、MCP Marketplace、Anthropic 官方等多来源,按分类和职业角色组织。",
    longSummary:
      "Qoder Community Skills 是 Qoder 社区维护的 skill 合集,把来自 skills.sh、MCP Marketplace、Anthropic 官方等多个来源的能力汇总在一起,按分类和职业角色组织,并鼓励社区贡献。提供中文界面,也可切换英文。\n\n它与已收录的 Qoder 官方市场是不同入口:后者偏厂商自营,这里更偏社区聚合。免费使用,可信度中等,适合想以中文视角、按角色发现 skill 的用户。",
    aiSummary: "适合按分类/职业角色发现多来源聚合的中文 skill 合集。",
    faqs: [
      { q: "Qoder Community Skills 是什么?", a: "Qoder 社区维护的 skill 合集,聚合 skills.sh、MCP Marketplace、Anthropic 官方等多来源,按分类和角色组织。" },
      { q: "它和 Qoder 官方市场有什么区别?", a: "官方市场偏厂商自营,Qoder Community 更偏社区聚合,汇总多来源并鼓励社区贡献。" }
    ],
    featured: false,
    recommended: false,
    trustLevel: "medium",
    status: "active",
    sourceUrls: ["https://qoder-community.pages.dev/zh/skills/"],
    addedAt: TODAY,
    updatedAt: TODAY
  },
  {
    id: "atcyrus-com-skills",
    slug: "atcyrus-com-skills",
    name: "Cyrus Skills",
    canonicalUrl: "https://www.atcyrus.com/skills",
    displayUrl: "atcyrus.com/skills",
    tags: ["Agent Skills", "合集"],
    category: "marketplace",
    language: ["en"],
    region: "global",
    type: "skill 合集",
    scale: "集合入口",
    pricing: "mixed",
    tagline: "面向开发者的 skill 市场",
    summary: "Cyrus 是一个英文 skill 市场,聚合面向 AI 编码 agent 的可复用能力,覆盖开发、DevOps、安全、设计等分类。",
    longSummary:
      "Cyrus(atcyrus.com)是一个面向开发者的英文 skill 市场,把用于增强 AI 编码 agent 的可复用能力(skill)集中托管,按开发、DevOps、安全、设计、文档、沟通、营销等分类组织。\n\n它的定价为部分付费:提供免费试用,也有付费方案。在 SkillFlux 中归入市场类,可信度为新兴——适合关注新来源、以开发工作流为主的用户,用于生产前建议核对具体 skill。",
    aiSummary: "适合按开发/DevOps/安全等分类挑选面向编码 agent 的 skill。",
    faqs: [
      { q: "Cyrus Skills 是什么?", a: "一个英文 skill 市场,聚合面向 AI 编码 agent 的可复用能力,按开发、安全、设计等分类组织。" },
      { q: "它收费吗?", a: "部分付费。提供免费试用,也有付费方案。" }
    ],
    featured: false,
    recommended: false,
    trustLevel: "emerging",
    status: "active",
    sourceUrls: ["https://www.atcyrus.com/skills"],
    addedAt: TODAY,
    updatedAt: TODAY
  },
  {
    id: "lobehub-com-skills",
    slug: "lobehub-com-skills",
    name: "LobeHub Skills",
    canonicalUrl: "https://lobehub.com/skills",
    displayUrl: "lobehub.com/skills",
    tags: ["Agent Skills", "合集", "LobeHub"],
    category: "marketplace",
    language: ["en", "zh"],
    region: "global",
    type: "skill 合集",
    scale: "集合入口",
    pricing: "free",
    tagline: "LobeHub 的 skill 市场",
    summary: "LobeHub Skills 是开源 AI 应用生态 LobeHub(LobeChat 背后团队)推出的 skill 市场,面向国际化的中英文用户。",
    longSummary:
      "LobeHub Skills 是 LobeHub 推出的 skill 市场。LobeHub 是开源 AI 助手 LobeChat 背后的团队,长期维护面向 AI 应用的开放生态,界面同时支持中英文。\n\n作为市场类来源,它把可复用的 agent 能力集中呈现,免费使用,可信度中等。适合已经在使用 LobeHub / LobeChat 生态、或偏好开源、国际化产品的用户。",
    aiSummary: "适合 LobeHub / LobeChat 生态用户发现开源风格的 skill。",
    faqs: [
      { q: "LobeHub Skills 是什么?", a: "开源 AI 应用生态 LobeHub(LobeChat 背后团队)推出的 skill 市场,支持中英文。" },
      { q: "它收费吗?", a: "免费。" }
    ],
    featured: false,
    recommended: false,
    trustLevel: "medium",
    status: "active",
    sourceUrls: ["https://lobehub.com/skills"],
    addedAt: TODAY,
    updatedAt: TODAY
  },
  {
    id: "mcpservers-org",
    slug: "mcpservers-org",
    name: "MCP Servers",
    canonicalUrl: "https://mcpservers.org/",
    displayUrl: "mcpservers.org",
    tags: ["MCP", "合集"],
    category: "directory",
    language: ["en"],
    region: "global",
    type: "MCP 服务器目录",
    scale: "集合入口",
    pricing: "free",
    tagline: "MCP 服务器目录",
    summary: "mcpservers.org 是一个精选的 MCP(Model Context Protocol)服务器目录,帮助发现兼容 Claude、Cursor、ChatGPT 的官方与社区服务器。",
    longSummary:
      "mcpservers.org 是一个精选的 MCP(Model Context Protocol)服务器目录,收录官方与社区构建的 MCP 服务器,按网页抓取、开发、生产力、金融等分类组织,便于开发者查找并集成扩展 AI 能力的工具。\n\n它兼容 Claude、Cursor、ChatGPT 等 agent,免费使用(含部分赞助/精选位)。在 SkillFlux 中它归入综合目录类,是 skill 之外补齐 MCP 生态的一个入口,可信度中等。",
    aiSummary: "适合发现兼容主流 agent 的 MCP 服务器,补齐 MCP 生态。",
    faqs: [
      { q: "mcpservers.org 是什么?", a: "一个精选的 MCP 服务器目录,收录官方与社区的 MCP 服务器,兼容 Claude、Cursor、ChatGPT 等。" },
      { q: "它和 skill 有什么关系?", a: "它聚焦 MCP 服务器而非 skill,是 SkillFlux 覆盖的 skill/MCP 生态中补齐 MCP 一侧的入口。" }
    ],
    featured: false,
    recommended: false,
    trustLevel: "medium",
    status: "active",
    sourceUrls: ["https://mcpservers.org/"],
    addedAt: TODAY,
    updatedAt: TODAY
  },
  {
    id: "cc-jiekou-ai-skills",
    slug: "cc-jiekou-ai-skills",
    name: "接口 AI Skills",
    canonicalUrl: "https://cc.jiekou.ai/skills",
    displayUrl: "cc.jiekou.ai/skills",
    tags: ["Agent Skills", "合集", "中文"],
    category: "marketplace",
    language: ["zh", "en"],
    region: "cn",
    type: "skill 合集",
    scale: "合集",
    pricing: "free",
    tagline: "可命令行安装的 skill 市场",
    summary: "接口 AI(cc.jiekou.ai)是一个中英双语、可通过命令行安装的开源 skill 市场,带有社区安装量排行榜。",
    longSummary:
      "接口 AI(cc.jiekou.ai)是一个面向 Claude agent 的中英双语 skill 市场,收录大量社区贡献的可复用能力,支持通过命令行(如 npx)直接安装,并提供按安装量排序的排行榜。\n\n它免费、偏开源风格,可信度为新兴。适合偏好命令行安装、并想通过热度信号发现优质 skill 的中文用户;用于生产前建议核对具体 skill 的维护状态。",
    aiSummary: "适合命令行安装、按安装量排行发现 skill 的中文用户。",
    faqs: [
      { q: "接口 AI Skills 是什么?", a: "一个中英双语、可命令行安装的开源 skill 市场,带社区安装量排行榜。" },
      { q: "怎么安装它的 skill?", a: "支持通过命令行(如 npx)直接安装,并可参考安装量排行选择。" }
    ],
    featured: false,
    recommended: false,
    trustLevel: "emerging",
    status: "active",
    sourceUrls: ["https://cc.jiekou.ai/skills"],
    addedAt: TODAY,
    updatedAt: TODAY
  }
];

const existingUrls = new Set(sites.map((s) => s.canonicalUrl));
const existingIds = new Set(sites.map((s) => s.id));
let added = 0;
for (const site of additions) {
  if (existingUrls.has(site.canonicalUrl) || existingIds.has(site.id)) {
    console.log("skip (already present):", site.slug);
    continue;
  }
  sites.push(site);
  added += 1;
}

writeFileSync(path, JSON.stringify(sites, null, 2) + "\n");
console.log(`Added ${added} sites. Total ${sites.length}.`);
