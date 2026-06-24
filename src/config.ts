export const SITE = {
  name: "技流 SkillFlux",
  shortName: "SkillFlux",
  description: "全网 skill/MCP 生态入口，聚合 skill 合集、市场、仓库、单项能力和机器可读索引。",
  url: process.env.SITE_URL || "https://skillflux.dev",
  locale: "zh-CN",
  author: "SkillFlux",
  packUrl: "https://skillflux.dev/pack?utm_source=skillflux&utm_medium=site&utm_campaign=mvp-pack",
  repoUrl: "https://github.com/skillflux/skillflux",
  schemaVersion: "2026-06-24"
} as const;

export const ENDPOINTS = [
  { path: "/llms.txt", label: "LLM quick map", description: "站点定位、标识、精选入口和数据端点说明。" },
  { path: "/llms-full.txt", label: "Full text catalog", description: "完整资源清单的纯文本版本。" },
  { path: "/index.json", label: "JSON index", description: "与 data/sites.json 保持一致的结构化索引。" },
  { path: "/feed.xml", label: "RSS feed", description: "新增和更新资源订阅流。" }
] as const;
