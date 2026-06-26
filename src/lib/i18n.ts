import type { Site } from "./content";

export const SUPPORTED_LANGUAGES = ["zh", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "zh";

type PageCopy = {
  htmlLang: string;
  locale: string;
  siteDescription: string;
  titleSuffix: string;
  nav: {
    homeLabel: string;
    directory: string;
    llms: string;
    pack: string;
    languageLabel: string;
  };
  home: {
    eyebrow: string;
    heroLead: string;
    browseDirectory: string;
    readForAi: string;
    rssSubscribe: string;
    packEntry: string;
    statsLabel: string;
    stats: {
      resources: string;
      labels: string;
      featured: string;
      updated: string;
    };
    panelAria: string;
    panelTitle: string;
    panelVersion: string;
    ledger: {
      directory: string;
      install: string;
      maintenance: string;
      adapters: string;
      resourcesSuffix: string;
      installValue: string;
      maintenanceValue: string;
      adaptersValue: string;
    };
    viewPack: string;
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
  cta: {
    eyebrow: string;
    title: string;
    body: string;
    command: string;
    copy: string;
    note: string;
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
    pack: string;
    copyrightNote: string;
  };
};

export const pageCopy: Record<Language, PageCopy> = {
  zh: {
    htmlLang: "zh-CN",
    locale: "zh-CN",
    siteDescription: "全网 skill/MCP 生态入口，聚合 skill 合集、市场、仓库、单项能力和机器可读索引。",
    titleSuffix: "skill/MCP 生态入口",
    nav: {
      homeLabel: "SkillFlux 首页",
      directory: "目录",
      llms: "llms.txt",
      pack: "精装包",
      languageLabel: "语言切换"
    },
    home: {
      eyebrow: "skill / mcp ecosystem index",
      heroLead: "skill 来源又多又散——官方厂商、市场、开源仓库、社区榜单都在这份免费目录里。懒得一个个找、一个个装？用 SkillFlux——精选 skill 的包管理器：一条命令接入 agent，按需安装、持续更新。",
      browseDirectory: "浏览目录",
      readForAi: "给 AI 读取",
      rssSubscribe: "RSS 订阅",
      packEntry: "精装包入口",
      statsLabel: "站点统计",
      stats: {
        resources: "收录入口",
        labels: "标识标签",
        featured: "精选入口",
        updated: "最近更新"
      },
      panelAria: "SkillFlux 精装包",
      panelTitle: "Deluxe Pack",
      panelVersion: "v0.1",
      ledger: {
        directory: "目录",
        install: "安装",
        maintenance: "维护",
        adapters: "适配",
        resourcesSuffix: "个入口",
        installValue: "一键 MCP",
        maintenanceValue: "JSON 更新",
        adaptersValue: "Claude · Cursor · Codex"
      },
      viewPack: "立即查看精装包",
      featuredEyebrow: "Featured",
      featuredTitle: "先从推荐和高频入口开始。",
      featuredNote: "首位是目标清单标注的推荐入口，其余按合集和高价值标识排序。每条都能进入详情页，再跳转原站。",
      labelsEyebrow: "Sources",
      labelsTitle: "按来源类型快速定位。",
      labelsNote: "官方厂商、市场、开源仓库、社区榜单还是综合目录——按来源类型直达，再用语言和可信度细筛。",
      labelCardKicker: "来源",
      labelCardDescription: (name) => `查看「${name}」类的 skill 来源。`,
      aiEyebrow: "For Agents",
      aiTitle: "让 AI 直接读懂整个目录。",
      aiNote: "所有机器可读文件都由同一份 JSON 生成，不依赖客户端 JavaScript。"
    },
    directory: {
      title: "完整目录",
      description: "浏览 SkillFlux 收录的 skill 合集、市场、仓库、工具和单项 skill 入口。",
      jsonLdName: "SkillFlux 完整目录",
      jsonLdDescription: "SkillFlux 收录的 skill/MCP 生态入口完整目录。",
      eyebrow: "Directory",
      heading: "全网 skill/MCP 生态入口，一处看全。",
      lede: "按名称、标识和摘要即时筛选。静态 HTML 仍保留全部内容，搜索引擎和 AI 不需要执行 JS 也能读取。",
      meta: (resourceCount, labelCount, updatedAt) => `${resourceCount} resources · ${labelCount} labels · updated ${updatedAt}`
    },
    cta: {
      eyebrow: "Skill 包管理器",
      title: "懒得一个个找、一个个装？",
      body: "SkillFlux 是一个精选 skill 的远程仓库——一条命令接入你的 agent，按项目按需安装、版本管理、持续更新。",
      command: "npx -y skillflux install",
      copy: "复制",
      note: "免费内测中 · 登录即用，无需付费"
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
      summary: "全网 skill/MCP 生态入口。先看目录，再决定装什么。",
      labels: "来源类型",
      forAi: "给 AI",
      brand: "品牌",
      directory: "完整目录",
      pack: "精装包入口",
      copyrightNote: "本站仅做导航与简介，内容版权归各集合站所有。"
    }
  },
  en: {
    htmlLang: "en",
    locale: "en",
    siteDescription: "A bilingual index for skill and MCP resources, covering marketplaces, collections, repositories, individual skills, and machine-readable feeds.",
    titleSuffix: "skill and MCP ecosystem index",
    nav: {
      homeLabel: "SkillFlux home",
      directory: "Directory",
      llms: "llms.txt",
      pack: "Pack",
      languageLabel: "Language switcher"
    },
    home: {
      eyebrow: "skill / mcp ecosystem index",
      heroLead: "Skill sources are scattered everywhere — vendors, marketplaces, open-source repos, and community rankings are all in this free directory. Don't want to hunt and install one by one? Use SkillFlux — the package manager for agent skills: one command to connect, install on demand, always maintained.",
      browseDirectory: "Browse directory",
      readForAi: "Read for AI",
      rssSubscribe: "RSS feed",
      packEntry: "Pack entry",
      statsLabel: "Site statistics",
      stats: {
        resources: "Resources",
        labels: "Labels",
        featured: "Featured",
        updated: "Updated"
      },
      panelAria: "SkillFlux pack",
      panelTitle: "Deluxe Pack",
      panelVersion: "v0.1",
      ledger: {
        directory: "Directory",
        install: "Install",
        maintenance: "Maintain",
        adapters: "Adapters",
        resourcesSuffix: "resources",
        installValue: "One-click MCP",
        maintenanceValue: "JSON updates",
        adaptersValue: "Claude · Cursor · Codex"
      },
      viewPack: "View pack",
      featuredEyebrow: "Featured",
      featuredTitle: "Start with the recommended and high-signal entries.",
      featuredNote: "The first entry is the marked recommendation from the source list. The rest are sorted by collection value and practical labels.",
      labelsEyebrow: "Sources",
      labelsTitle: "Find skills by source type.",
      labelsNote: "Official vendors, marketplaces, open-source repos, community rankings, or aggregators — jump by source type, then refine by language and trust.",
      labelCardKicker: "source",
      labelCardDescription: (name) => `Browse ${name} skill sources.`,
      aiEyebrow: "For agents",
      aiTitle: "Let AI read the whole directory directly.",
      aiNote: "Every machine-readable file is generated from the same JSON catalog and works without client-side JavaScript."
    },
    directory: {
      title: "Directory",
      description: "Browse SkillFlux resources across skill collections, marketplaces, repositories, tools, and individual skills.",
      jsonLdName: "SkillFlux Directory",
      jsonLdDescription: "The full SkillFlux directory of skill and MCP ecosystem resources.",
      eyebrow: "Directory",
      heading: "A single place to scan the skill/MCP ecosystem.",
      lede: "Filter instantly by name, label, and summary. Static HTML keeps everything readable for search engines and AI without JavaScript.",
      meta: (resourceCount, labelCount, updatedAt) => `${resourceCount} resources · ${labelCount} labels · updated ${updatedAt}`
    },
    cta: {
      eyebrow: "Skill package manager",
      title: "Tired of hunting and installing one by one?",
      body: "SkillFlux is a curated skill registry — one command connects it to your agent. Install per project, on demand, versioned, and always up to date.",
      command: "npx -y skillflux install",
      copy: "Copy",
      note: "Free beta · sign in and go, no payment"
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
      summary: "A skill/MCP ecosystem index. Scan the directory first, then decide what to install.",
      labels: "Source types",
      forAi: "For AI",
      brand: "Brand",
      directory: "Directory",
      pack: "Pack entry",
      copyrightNote: "SkillFlux is a navigation and summary layer. Rights belong to the original resource owners."
    }
  }
};

const tagTranslations: Record<string, string> = {
  推荐: "Recommended",
  合集: "Collection",
  "单项 skill": "Single skill",
  中文: "Chinese",
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
  社媒: "Social"
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
  "skill 文档": "Skill documentation",
  "skill 下载包": "Skill download package",
  "npm skill 包": "npm skill package"
};

const scaleTranslations: Record<string, string> = {
  推荐合集: "Recommended collection",
  集合入口: "Collection entry",
  开源项目: "Open-source project",
  下载包: "Download package",
  "单项 skill": "Single skill",
  合集: "Collection",
  "合集(阿里云)": "Alibaba Cloud collection",
  "合集(腾讯云)": "Tencent Cloud collection",
  合集仓库: "Collection repository"
};

export function getPageCopy(lang: Language = DEFAULT_LANGUAGE): PageCopy {
  return pageCopy[lang];
}

export function localizePath(path: string, lang: Language): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const withoutEnglishPrefix = normalized === "/en" ? "/" : normalized.replace(/^\/en(?=\/)/, "");
  if (lang === "zh") return withoutEnglishPrefix;
  return withoutEnglishPrefix === "/" ? "/en/" : `/en${withoutEnglishPrefix}`;
}

export function getAlternateLanguagePath(currentPath: string, targetLang: Language): string {
  return localizePath(currentPath, targetLang);
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
      tagline: site.tagline,
      summary: site.summary,
      aiSummary: site.aiSummary,
      tags: site.tags
    };
  }

  const tags = translateTags(site.tags, lang);
  const type = translateType(site.type, lang);
  const scale = translateScale(site.scale, lang);
  const primaryTags = tags.slice(0, 3).join(" / ");

  return {
    name: site.name,
    type,
    scale,
    tagline: site.recommended ? "China's most complete big-vendor skill hub" : `${type} entry`,
    summary: `${site.name} is a ${type.toLowerCase()} in the SkillFlux catalog. Use it to discover, compare, or install agent skill resources from the original source.`,
    aiSummary: site.recommended
      ? "The most complete commercial skills hub — a strong place to start."
      : `Useful when you are scanning by ${primaryTags || "resource"} signals before opening the source site.`,
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
      description: "A feed for newly added and updated resources."
    }
  }
};

export function getEndpointCopy(endpoint: { path: string; label: string; description: string }, lang: Language) {
  return endpointCopy[lang][endpoint.path] ?? {
    label: endpoint.label,
    description: endpoint.description
  };
}
