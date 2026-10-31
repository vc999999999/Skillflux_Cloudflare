import type { Site } from "./content";

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

/** English lives at the root; every other language under its own prefix. */
export const LANGUAGE_PREFIX: Record<Language, string> = { en: "", zh: "/zh" };

type PageCopy = {
  htmlLang: string;
  locale: string;
  siteDescription: string;
  titleSuffix: string;
  nav: {
    homeLabel: string;
    directory: string;
    llms: string;
    languageLabel: string;
  };
  home: {
    eyebrow: string;
    heroLead: string;
    browseDirectory: string;
    readForAi: string;
    rssSubscribe: string;
    statsLabel: string;
    stats: {
      resources: string;
      labels: string;
      featured: string;
      updated: string;
    };
    featuredEyebrow: string;
    featuredTitle: string;
    featuredNote: string;
    labelsEyebrow: string;
    labelsTitle: string;
    labelsNote: string;
    labelCardKicker: string;
    labelCardDescription: (tag: string) => string;
    aiEyebrow: string;
    aiTitle: string;
    aiNote: string;
  };
  directory: {
    title: string;
    description: string;
    jsonLdName: string;
    jsonLdDescription: string;
    eyebrow: string;
    heading: string;
    lede: string;
    meta: (resourceCount: number, labelCount: number, updatedAt: string) => string;
  };
  breadcrumb: {
    home: string;
    directory: string;
    tags: string;
    categories: string;
    guides: string;
    insights: string;
  };
  guidesPage: {
    eyebrow: string;
    indexTitle: string;
    indexLede: string;
    indexDescription: string;
    updatedPrefix: string;
    readMore: string;
    ctaTitle: string;
    ctaBody: string;
  };
  insightsPage: {
    eyebrow: string;
    indexTitle: string;
    indexLede: string;
    indexDescription: string;
    updatedPrefix: string;
    readMore: string;
    industryLabel: string;
    tldrLabel: string;
    scenariosTitle: string;
    painPointsTitle: string;
    painHeader: string;
    solutionHeader: string;
    workflowTitle: string;
    judgmentsTitle: string;
    deepDiveTitle: string;
    limitationsTitle: string;
    sourceTitle: string;
    sourceRepo: string;
    sourceAuthor: string;
    sourceLicense: string;
    sourceNote: string;
    visitRepo: string;
    relatedTitle: string;
    machineNote: string;
    zhOnlyNote: string;
  };
  collections: {
    tagEyebrow: string;
    tagHeading: (tag: string) => string;
    tagLede: (tag: string, count: number) => string;
    tagTitle: (tag: string) => string;
    tagDescription: (tag: string, count: number) => string;
    categoryEyebrow: string;
    categoryLede: (label: string, count: number) => string;
    categoryTitle: (label: string) => string;
    categoryDescription: (label: string, count: number) => string;
    browseTagsTitle: string;
    browseTagsNote: string;
  };
  faq: {
    heading: string;
    whatIs: (name: string) => string;
    whoFor: (name: string) => string;
    pricingQ: (name: string) => string;
    accessQ: (name: string) => string;
    accessA: (name: string, url: string) => string;
  };
  resource: {
    recommended: string;
    details: string;
    external: string;
    tableEyebrow: string;
    tableNote: string;
    searchLabel: string;
    searchPlaceholder: string;
    categoryLabel: string;
    regionLabel: string;
    trustLabel: string;
    all: string;
    countSuffix: string;
    tableHeaders: {
      number: string;
      resource: string;
      source: string;
      locale: string;
      trust: string;
    };
  };
  detail: {
    labels: string;
    pricing: string;
    status: string;
    updated: string;
    visit: string;
    intro: string;
    aiRead: string;
    sourceLinks: string;
    positioning: string;
    tags: string;
    machine: string;
    related: string;
    positionText: (siteName: string, tags: string) => string;
    machineText: string;
  };
  footer: {
    summary: string;
    labels: string;
    forAi: string;
    brand: string;
    directory: string;
    copyrightNote: string;
  };
};

export const pageCopy: Record<Language, PageCopy> = {
  zh: {
    htmlLang: "zh-CN",
    locale: "zh-CN",
    siteDescription: "Agent Skill 黄页与实测数据：按任务找 Skill，按类型找市场、官方合集与开源仓库；每个条目链接原始出处，体检数据以 CC BY 4.0 公开。",
    titleSuffix: "想给你的 Agent 增加什么能力？· 功能黄页",
    nav: {
      homeLabel: "SkillFlux 首页",
      directory: "目录",
      llms: "llms.txt",
      languageLabel: "语言切换"
    },
    home: {
      eyebrow: "capabilities to add to your agent",
      heroLead: "按任务找 Agent Skill，按类型找它们的发布来源。每个条目都链接原始出处；收录不代表测试，体检与实测结果单独公开。",
      browseDirectory: "查找想增加的能力",
      readForAi: "给 AI 读取",
      rssSubscribe: "RSS 订阅",
      statsLabel: "站点统计",
      stats: {
        resources: "可选能力",
        labels: "能力标签",
        featured: "精选推荐",
        updated: "最近更新"
      },
      featuredEyebrow: "Curated",
      featuredTitle: "常用且高频的能力推荐入口。",
      featuredNote: "首位是官方与核心能力推荐，其余按高频场景排序。每条都能进入详情页，查看如何给 Agent 接入。",
      labelsEyebrow: "Categories",
      labelsTitle: "按想增加的能力类型查找。",
      labelsNote: "官方厂商、开放市场、源码仓库或开发者社区——按类别直达，快速找到你想给 Agent 装配的工具与技能。",
      labelCardKicker: "类别",
      labelCardDescription: (name) => `查看「${name}」类你想给 Agent 增加的能力来源。`,
      aiEyebrow: "For Agents",
      aiTitle: "让你的 AI Agent 自己来查想增加的能力。",
      aiNote: "提供结构化纯文本与 JSON 数据，AI Agent 可自主检索并提出安装建议。"
    },
    directory: {
      title: "功能黄页",
      description: "想给你的 Agent 增加什么能力？浏览 SkillFlux 收录的全网 Agent 能力来源，包括 Skills、MCP 工具、插件与开源项目。",
      jsonLdName: "SkillFlux 功能黄页",
      jsonLdDescription: "AI Agent 功能黄页：想给你的 Agent 增加什么能力？全网能力目录。",
      eyebrow: "Yellow Pages",
      heading: "想给你的 Agent 增加什么能力？",
      lede: "Agent Skill 来源黄页：浏览与检索发布 Skill、MCP 工具与插件的市场、官方合集和开源仓库。静态呈现，人和 AI 均可免 JS 读取。",
      meta: (resourceCount, labelCount, updatedAt) => `${resourceCount} resources · ${labelCount} labels · updated ${updatedAt}`
    },
    breadcrumb: {
      home: "首页",
      directory: "完整目录",
      tags: "标签",
      categories: "来源类型",
      guides: "指南",
      insights: "Skill 拆解"
    },
    guidesPage: {
      eyebrow: "指南",
      indexTitle: "skill / MCP 上手指南",
      indexLede: "从哪里下载、如何挑选来源、怎么接入 agent——这些高频问题的答案，整理成可直接引用的长文。",
      indexDescription: "SkillFlux 指南：Claude Skills 下载、skill 来源挑选、MCP 接入等实操长文。",
      updatedPrefix: "更新于",
      readMore: "阅读全文",
      ctaTitle: "看完就想动手？",
      ctaBody: "SkillFlux 是精选 skill 的包管理器，一条命令接入 agent，按需安装、持续更新。"
    },
    insightsPage: {
      eyebrow: "Skill 拆解",
      indexTitle: "Skill 拆解：各行业 skill 的精华流程与痛点",
      indexLede: "把优秀 skill 里编码的经验拆开讲清楚：它解决什么行业痛点、流程怎么走、专家判断藏在哪、边界在哪里。给人看，也给 AI 学。",
      indexDescription: "SkillFlux Skill 拆解专题：逐个拆解优秀 agent skill 的工作流、专家判断与行业痛点，附来源署名与协议信息。",
      updatedPrefix: "更新于",
      readMore: "阅读拆解",
      industryLabel: "行业",
      tldrLabel: "TL;DR · 给 AI 的一句话",
      scenariosTitle: "适用场景",
      painPointsTitle: "痛点 → 解法",
      painHeader: "行业痛点",
      solutionHeader: "skill 的解法",
      workflowTitle: "编码的经验流程",
      judgmentsTitle: "编码的专家判断",
      deepDiveTitle: "深度解读",
      limitationsTitle: "局限与边界",
      sourceTitle: "来源与署名",
      sourceRepo: "原始仓库",
      sourceAuthor: "作者",
      sourceLicense: "协议",
      sourceNote: "本文是对原 skill 的分析与评论，不转载其全文。使用该 skill 前请阅读原仓库协议。",
      visitRepo: "访问原仓库",
      relatedTitle: "相关收录入口",
      machineNote: "此拆解同步出现在 `/insights/feed.xml` 与 `/llms.txt`，便于订阅工具和 AI agent 直接消费。",
      zhOnlyNote: "拆解正文目前仅提供中文版。"
    },
    collections: {
      tagEyebrow: "标签",
      tagHeading: (tag) => `「${tag}」相关的 skill/MCP 入口`,
      tagLede: (tag, count) => `已收录 ${count} 个带「${tag}」标识的 skill/MCP 来源，覆盖官方厂商、市场、开源仓库和社区榜单。逐条查看类型、语言、定价和可信度，再决定跳转哪一个。`,
      tagTitle: (tag) => `${tag} skill/MCP 入口合集`,
      tagDescription: (tag, count) => `SkillFlux 收录的 ${count} 个「${tag}」相关 skill/MCP 来源目录：类型、语言、定价、可信度一览。`,
      categoryEyebrow: "来源类型",
      categoryLede: (label, count) => `${label} 类目下已收录 ${count} 个 skill/MCP 来源。按语言和可信度细筛，先看详情再跳转原站。`,
      categoryTitle: (label) => `${label} · skill/MCP 来源目录`,
      categoryDescription: (label, count) => `SkillFlux 收录的 ${count} 个${label}类 skill/MCP 来源，含类型、语言、定价与可信度标识。`,
      browseTagsTitle: "按标签浏览",
      browseTagsNote: "每个标签都是一个独立入口页，方便搜索引擎和 AI 按主题收录。"
    },
    faq: {
      heading: "常见问题",
      whatIs: (name) => `${name} 是什么？`,
      whoFor: (name) => `${name} 适合谁使用？`,
      pricingQ: (name) => `${name} 收费吗？`,
      accessQ: (name) => `如何访问 ${name}？`,
      accessA: (name, url) => `点击本页「访问原站」按钮，或直接打开 ${url} 即可进入 ${name} 原站。SkillFlux 只做导航与简介，不代理其内容。`
    },
    resource: {
      recommended: "推荐",
      details: "详情",
      external: "外链",
      tableEyebrow: "DIRECTORY",
      tableNote: "每个来源都标了类型、语言、定价和可信度。先看详情，再跳转原站。",
      searchLabel: "搜索",
      searchPlaceholder: "名称、标签、摘要",
      categoryLabel: "按来源类型",
      regionLabel: "按语言",
      trustLabel: "按可信度",
      all: "全部",
      countSuffix: "条",
      tableHeaders: {
        number: "No.",
        resource: "来源站",
        source: "类型",
        locale: "语言 / 定价",
        trust: "可信度"
      }
    },
    detail: {
      labels: "标识",
      pricing: "定价",
      status: "状态",
      updated: "更新",
      visit: "访问原站",
      intro: "简介",
      aiRead: "AI 解读",
      sourceLinks: "来源链接",
      positioning: "资源定位",
      tags: "标签",
      machine: "机器读取",
      related: "相关入口",
      positionText: (siteName, tags) => `${siteName} 带有「${tags}」标识，适合根据类型、信任层级和 AI 解读快速判断是否值得深入。`,
      machineText: "此条目同步出现在 `/index.json` 和 `/llms-full.txt`，便于搜索工具和 AI agent 直接消费。"
    },
    footer: {
      summary: "Agent Skill 黄页与开放实测数据。收录来源，链接原始出处，公开可复核的结果。",
      labels: "来源类别",
      forAi: "给 AI",
      brand: "品牌",
      directory: "功能黄页",
      copyrightNote: "本站仅做导航与简介，内容版权归各集合站所有。"
    }
  },
  en: {
    htmlLang: "en",
    locale: "en",
    siteDescription: "Agent skill directory and open test data: find skills by task and their sources by type — marketplaces, vendor collections and open-source repos. Every entry links to the original; health check data is open under CC BY 4.0.",
    titleSuffix: "Capabilities to Add to Your AI Agent",
    nav: {
      homeLabel: "SkillFlux home",
      directory: "Directory",
      llms: "llms.txt",
      languageLabel: "Language switcher"
    },
    home: {
      eyebrow: "capabilities to add to your agent",
      heroLead: "Find agent skills by task and the sources that publish them by type. Every entry links to the original; a listing is not a test result, and health checks and benchmarks are published separately.",
      browseDirectory: "Find capabilities for your agent",
      readForAi: "Read for AI",
      rssSubscribe: "RSS feed",
      statsLabel: "Catalog metrics",
      stats: {
        resources: "Available capabilities",
        labels: "Topics & tags",
        featured: "Curated",
        updated: "Updated"
      },
      featuredEyebrow: "Curated",
      featuredTitle: "Popular capabilities to add to your agent.",
      featuredNote: "Curated capabilities with transparent reasoning, task fit, and clear documentation. Jump into details or connect to your agent.",
      labelsEyebrow: "Categories",
      labelsTitle: "Browse by capability category.",
      labelsNote: "Official platforms, marketplaces, open-source repos, and developer lists — jump by category to find tools and skills to equip your agent.",
      labelCardKicker: "category",
      labelCardDescription: (name) => `Browse ${name} capabilities for your agent.`,
      aiEyebrow: "For agents",
      aiTitle: "Let your AI agent find capabilities for itself.",
      aiNote: "Structured machine-readable data enables your agent to discover, compare, and propose capabilities autonomously."
    },
    directory: {
      title: "Agent Capabilities",
      description: "What capabilities do you want to add to your agent? Browse skills, MCP tools, plugins, and workflows across the open ecosystem.",
      jsonLdName: "SkillFlux Agent Capabilities Yellow Pages",
      jsonLdDescription: "Capabilities you want to add to your AI agent: skills, MCP tools, plugins, and frameworks.",
      eyebrow: "Yellow Pages",
      heading: "What capabilities do you want to add to your agent?",
      lede: "A directory of the marketplaces, vendor collections and open-source repos that publish agent skills, MCP tools and plugins. Static pages that people and AI can read without JavaScript.",
      meta: (resourceCount, labelCount, updatedAt) => `${resourceCount} capabilities · ${labelCount} topics · updated ${updatedAt}`
    },
    breadcrumb: {
      home: "Home",
      directory: "Directory",
      tags: "Tags",
      categories: "Source types",
      guides: "Guides",
      insights: "Skill deep-dives"
    },
    guidesPage: {
      eyebrow: "Guides",
      indexTitle: "skill / MCP getting-started guides",
      indexLede: "Where to download, how to pick a source, how to connect an agent — the answers to these common questions, written as long-form you can quote.",
      indexDescription: "SkillFlux guides: downloading Claude Skills, choosing a skill source, connecting MCP, and more.",
      updatedPrefix: "Updated",
      readMore: "Read more",
      ctaTitle: "Ready to try it?",
      ctaBody: "SkillFlux is a package manager for curated skills — one command connects your agent, install on demand, always maintained."
    },
    insightsPage: {
      eyebrow: "Skill deep-dives",
      indexTitle: "Skill deep-dives: expert workflows and pain points, by industry",
      indexLede: "We take outstanding agent skills apart: which industry pain they solve, how the encoded workflow runs, where the expert judgment hides, and where the limits are. Written for humans — and for AI to learn from.",
      indexDescription: "SkillFlux skill deep-dives: analyses of outstanding agent skills — workflows, expert judgment, industry pain points, with full source attribution.",
      updatedPrefix: "Updated",
      readMore: "Read the deep-dive",
      industryLabel: "Industry",
      tldrLabel: "TL;DR · one line for AI",
      scenariosTitle: "Use cases",
      painPointsTitle: "Pain → solution",
      painHeader: "Industry pain point",
      solutionHeader: "How the skill solves it",
      workflowTitle: "The encoded workflow",
      judgmentsTitle: "The encoded expert judgment",
      deepDiveTitle: "Deep dive",
      limitationsTitle: "Limits and boundaries",
      sourceTitle: "Source and attribution",
      sourceRepo: "Original repository",
      sourceAuthor: "Author",
      sourceLicense: "License",
      sourceNote: "This article is analysis and commentary on the original skill; it does not reproduce it. Read the repository license before using the skill.",
      visitRepo: "Visit the repository",
      relatedTitle: "Related directory entries",
      machineNote: "This deep-dive is also available via `/insights/feed.xml` and `/llms.txt` for feed readers and AI agents.",
      zhOnlyNote: "Deep-dive articles are currently written in Chinese."
    },
    collections: {
      tagEyebrow: "Tag",
      tagHeading: (tag) => `${tag} skill/MCP entries`,
      tagLede: (tag, count) => `${count} skill/MCP sources tagged ${tag}, spanning official vendors, marketplaces, open-source repos, and community rankings. Check each entry's type, language, pricing, and trust before you jump.`,
      tagTitle: (tag) => `${tag} skill/MCP directory`,
      tagDescription: (tag, count) => `A directory of ${count} ${tag} skill/MCP sources indexed by SkillFlux — type, language, pricing, and trust at a glance.`,
      categoryEyebrow: "Source type",
      categoryLede: (label, count) => `${count} skill/MCP sources in the ${label} category. Refine by language and trust, review details, then visit the source.`,
      categoryTitle: (label) => `${label} · skill/MCP source directory`,
      categoryDescription: (label, count) => `${count} ${label} skill/MCP sources indexed by SkillFlux, with type, language, pricing, and trust signals.`,
      browseTagsTitle: "Browse by tag",
      browseTagsNote: "Each tag is its own landing page so search engines and AI can index the catalog by topic."
    },
    faq: {
      heading: "FAQ",
      whatIs: (name) => `What is ${name}?`,
      whoFor: (name) => `Who is ${name} for?`,
      pricingQ: (name) => `Is ${name} free?`,
      accessQ: (name) => `How do I access ${name}?`,
      accessA: (name, url) => `Use the "Visit source" button on this page, or open ${url} directly to reach ${name}. SkillFlux only provides navigation and summaries; it does not proxy the content.`
    },
    resource: {
      recommended: "Recommended",
      details: "Details",
      external: "Source",
      tableEyebrow: "DIRECTORY",
      tableNote: "Every source is tagged with its type, language, pricing, and trust. Check details, then jump to the original.",
      searchLabel: "Search",
      searchPlaceholder: "Name, labels, summary",
      categoryLabel: "By source type",
      regionLabel: "By language",
      trustLabel: "By trust",
      all: "All",
      countSuffix: "items",
      tableHeaders: {
        number: "No.",
        resource: "Source",
        source: "Type",
        locale: "Language / Pricing",
        trust: "Trust"
      }
    },
    detail: {
      labels: "Labels",
      pricing: "Pricing",
      status: "Status",
      updated: "Updated",
      visit: "Visit source",
      intro: "Overview",
      aiRead: "AI read",
      sourceLinks: "Source links",
      positioning: "Resource positioning",
      tags: "Tags",
      machine: "Machine-readable",
      related: "Related entries",
      positionText: (siteName, tags) => `${siteName} is tagged with ${tags}. Use its type, trust signal, and AI read to decide whether to inspect it further.`,
      machineText: "This entry is also available in `/index.json` and `/llms-full.txt` for search tools and AI agents."
    },
    footer: {
      summary: "Agent skill directory and open test data. Sources listed, originals linked, results you can verify.",
      labels: "Source categories",
      forAi: "For AI",
      brand: "Brand",
      directory: "Yellow Pages",
      copyrightNote: "SkillFlux is an open navigation and summary layer. Rights belong to the original resource owners."
    }
  }
};

const tagTranslations: Record<string, string> = {
  推荐: "Recommended",
  合集: "Collection",
  "单项 skill": "Single skill",
  中文: "Chinese-language",
  开源: "Open source",
  视频: "Video",
  测试: "Testing",
  图像: "Image",
  写作: "Writing",
  阿里云: "Alibaba Cloud",
  文档: "Docs",
  下载包: "Download",
  音乐: "Music",
  天气: "Weather",
  财务: "Finance",
  社媒: "Social",
  官方: "Official",
  移动开发: "Mobile Development",
  安全: "Security",
  框架: "Framework"
};

const categoryTranslations: Record<string, string> = {
  official: "Official vendors",
  marketplace: "Marketplaces",
  repo: "Open-source repos",
  community: "Community & rankings",
  directory: "Aggregator directories"
};

const regionLabels: Record<Language, Record<string, string>> = {
  zh: { cn: "中文", global: "国际" },
  en: { cn: "Chinese", global: "Global" }
};

const trustLabels: Record<Language, Record<string, string>> = {
  zh: { high: "高", medium: "中", emerging: "新兴" },
  en: { high: "High", medium: "Medium", emerging: "Emerging" }
};

const pricingLabels: Record<Language, Record<string, string>> = {
  zh: { free: "免费", mixed: "部分付费", paid: "付费" },
  en: { free: "Free", mixed: "Freemium", paid: "Paid" }
};

const typeTranslations: Record<string, string> = {
  "skill 合集": "Skill collection",
  "单项 skill": "Single skill",
  "开源 skill 仓库": "Open-source skill repository",
  "开源可视化讲解 Skill": "Open-source explainer skill",
  "实证研究 Skill 来源合集": "Empirical research skill collection",
  "开源 Skill 与 MCP 项目": "Open-source skill and MCP project",
  "科研 Agent Skill 仓库": "Scientific agent skill repository",
  "skill 文档": "Skill documentation",
  "skill 下载包": "Skill download package",
  "npm skill 包": "npm skill package",
  "MCP 服务器目录": "MCP server directory"
};

const siteNameTranslations: Record<string, string> = {
  "魔搭 ModelScope Skills": "ModelScope Skills",
  "阿里云 Skills": "Alibaba Cloud Skills",
  "腾讯云 SkillHub": "Tencent Cloud SkillHub",
  "Android Skills(官方)": "Android Skills (Official)",
  "Expo Skills(官方)": "Expo Skills (Official)",
  "everything-claude-code 中文版": "everything-claude-code (Chinese Edition)",
  "接口 AI Skills": "Jiekou AI Skills"
};

const scaleTranslations: Record<string, string> = {
  推荐合集: "Recommended collection",
  "单个 Skill 与渲染脚本": "Single skill with renderer script",
  "3 个主技能 + 3 个支持技能": "3 main + 3 support skills",
  "38 个 Skill": "38 skills",
  "Skill 包与独立分析工具": "Skill package with separate analysis tools",
  "2 个主技能 + 1 个支持技能": "2 main + 1 support skill",
  集合入口: "Collection entry",
  开源项目: "Open-source project",
  下载包: "Download package",
  "单项 skill": "Single skill",
  合集: "Collection",
  "合集(阿里云)": "Alibaba Cloud collection",
  "合集(腾讯云)": "Tencent Cloud collection",
  "合集(企业)": "Enterprise collection",
  企业: "Enterprise",
  "合集(qoder)": "Qoder collection",
  "合集(tessl)": "Tessl collection",
  合集仓库: "Collection repository"
};

export function getPageCopy(lang: Language = DEFAULT_LANGUAGE): PageCopy {
  return pageCopy[lang];
}


/** Removes a language prefix. The retired /en/ prefix is accepted for old links. */
export function stripLanguagePrefix(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/zh" || normalized === "/en") return "/";
  return normalized.replace(/^\/(?:zh|en)(?=\/)/, "");
}

export function localizePath(path: string, lang: Language): string {
  const bare = stripLanguagePrefix(path);
  const prefix = LANGUAGE_PREFIX[lang];
  if (!prefix) return bare;
  return bare === "/" ? `${prefix}/` : `${prefix}${bare}`;
}

export function languageOfPath(path: string): Language {
  return /^\/zh(?:\/|$)/.test(path) ? "zh" : "en";
}

/** An article lives only at the URL of the language it was written in. */
export function insightPath(entry: { id: string; data: { lang?: Language } }): string {
  return localizePath(`/insights/${entry.id}/`, entry.data.lang ?? "zh");
}

export const HREFLANG: Record<Language, string> = { en: "en", zh: "zh-CN" };

/** getStaticPaths for pages that exist in every language: `/x/` and `/zh/x/`. */
export function langStaticPaths() {
  return SUPPORTED_LANGUAGES.map((lang) => ({
    params: { lang: LANGUAGE_PREFIX[lang].slice(1) || undefined },
    props: { lang }
  }));
}

export function getAlternateLanguagePath(currentPath: string, targetLang: Language): string {
  return localizePath(currentPath, targetLang);
}

export function translateSiteName(name: string, lang: Language): string {
  if (lang === "zh") return name;
  return siteNameTranslations[name] ?? name;
}

export function translateTag(tag: string, lang: Language): string {
  if (lang === "zh") return tag;
  return tagTranslations[tag] ?? tag;
}

export function translateCategory(slug: string, zhLabel: string, lang: Language): string {
  if (lang === "zh") return zhLabel;
  return categoryTranslations[slug] ?? zhLabel;
}

export function translateRegion(region: string, lang: Language): string {
  return regionLabels[lang][region] ?? region;
}

export function translateTrust(level: string, lang: Language): string {
  return trustLabels[lang][level] ?? level;
}

export function translatePricing(pricing: string, lang: Language): string {
  return pricingLabels[lang][pricing] ?? pricing;
}

export function translateTags(tags: string[], lang: Language): string[] {
  return tags.map((tag) => translateTag(tag, lang));
}

export function translateType(type: string, lang: Language): string {
  if (lang === "zh") return type;
  return typeTranslations[type] ?? type;
}

export function translateScale(scale: string, lang: Language): string {
  if (lang === "zh") return scale;
  return scaleTranslations[scale] ?? scale.replace(/^合集\((.+)\)$/, "$1 collection");
}

export function getSiteCopy(site: Site, lang: Language) {
  if (lang === "zh") {
    return {
      name: site.name,
      type: site.type,
      scale: site.scale,
      tagline: site.editorial?.primaryCapability.zh ?? site.tagline,
      summary: site.editorial?.summary.zh ?? site.summary,
      aiSummary: site.aiSummary,
      tags: site.tags
    };
  }

  const name = translateSiteName(site.name, lang);
  const tags = translateTags(site.tags, lang);
  const type = translateType(site.type, lang);
  const scale = translateScale(site.scale, lang);
  const primaryTags = tags.slice(0, 3).join(" / ");

  return {
    name,
    type,
    scale,
    tagline: site.editorial?.primaryCapability.en ?? `${type} entry`,
    summary: site.editorial?.summary.en ?? `${name}: source information is being prepared for the English directory.`,
    aiSummary: `A catalog source indexed by ${primaryTags || "resource"} signals. Directory inclusion is not evidence that its individual skills have passed SkillFlux testing.`,
    tags
  };
}

const endpointCopy: Record<Language, Record<string, { label: string; description: string }>> = {
  zh: {},
  en: {
    "/llms.txt": {
      label: "LLM quick map",
      description: "Site positioning, labels, featured entries, and endpoint notes."
    },
    "/llms-full.txt": {
      label: "Full text catalog",
      description: "A complete plain-text version of the resource catalog."
    },
    "/index.json": {
      label: "JSON index",
      description: "Structured catalog data generated from the same source as the site."
    },
    "/feed.xml": {
      label: "RSS feed",
      description: "A feed for resource additions, capability updates and new or revised skill deep-dives."
    },
    "/insights/feed.xml": {
      label: "Insights RSS",
      description: "A feed for skill deep-dives: expert workflows and pain-point analyses by industry."
    }
  }
};

export function getEndpointCopy(endpoint: { path: string; label: string; description: string }, lang: Language) {
  return endpointCopy[lang][endpoint.path] ?? {
    label: endpoint.label,
    description: endpoint.description
  };
}
