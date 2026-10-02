export const SITE = {
  name: "SkillFlux",
  shortName: "SkillFlux",
  description: "AI Agent 功能黄页：想给你的 Agent 增加什么能力？一站式检索全网 Agent Skills、MCP 工具、插件与开源生态。按需选型、透明验证，即插即用。",
  url: process.env.SITE_URL || "https://skillflux.app",
  locale: "zh-CN",
  author: "SkillFlux",
  repoUrl: "https://github.com/vc999999999/Skillflux_Cloudflare",
  schemaVersion: "2026-06-24",
  // Cloudflare Web Analytics beacon token. Not a secret — it ships in the HTML.
  // CF_BEACON_TOKEN env var overrides this default if set at build time.
  cfBeaconToken: process.env.CF_BEACON_TOKEN ?? "0c6501b32d2e4f43b3474095fed697d3",
  // Search / webmaster site-verification codes. Paste the value each platform
  // gives you (meta-tag method) here or via the matching env var. Empty = no tag.
  verification: {
    // Global
    google: process.env.GOOGLE_VERIFY ?? "56VjAx8K5mjpKWKm_9-v62j19Zv6GjAhiSbPzZKgC-s", // Google Search Console → google-site-verification
    bing: process.env.BING_VERIFY ?? "C16EFBFC9E381FD0BE5E7D0846F8E3AF", // Bing Webmaster → msvalidate.01
    yandex: process.env.YANDEX_VERIFY ?? "", // Yandex Webmaster → yandex-verification
    // CN
    baidu: process.env.BAIDU_VERIFY ?? "", // 百度搜索资源平台 → baidu-site-verification
    sogou: process.env.SOGOU_VERIFY ?? "", // 搜狗站长平台 → sogou_site_verification
    so360: process.env.SO360_VERIFY ?? "", // 360 站长平台 → 360-site-verification
    shenma: process.env.SHENMA_VERIFY ?? "" // 神马站长平台 → shenma-site-verification
  }
} as const;

export const ENDPOINTS = [
  { path: "/llms.txt", label: "LLM quick map", description: "站点定位、标识、精选入口和数据端点说明。" },
  { path: "/llms-full.txt", label: "Full text catalog", description: "完整资源清单的纯文本版本。" },
  { path: "/index.json", label: "JSON index", description: "与 data/sites.json 保持一致的结构化索引。" },
  { path: "/feed.xml", label: "RSS feed", description: "新增和更新资源订阅流。" },
  { path: "/insights/feed.xml", label: "Insights RSS", description: "保留的编辑解读订阅流，不代表平台人工实测。" },
  { path: "/skills-index.json", label: "Curated releases", description: "构建时从 GitHub 目录仓库生成的精品版本索引；安装前客户端重新检查仓库状态。" },
  { path: "/scenarios/index.json", label: "Scenarios", description: "场景、选型和维护指南的结构化目录。" }
] as const;
