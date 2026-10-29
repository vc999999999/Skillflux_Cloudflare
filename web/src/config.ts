export const SITE = {
  name: "SkillFlux",
  shortName: "SkillFlux",
  description: "SkillFlux tests AI agent skills and publishes the results as open data, alongside a directory of skill sources for Claude Code, Codex and Cursor.",
  url: process.env.SITE_URL || "https://skillflux.app",
  locale: "en",
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
  { path: "/AGENTS.md", label: "Agent entry point", description: "How agents should read and cite SkillFlux: reading order, citation rules and routing." },
  { path: "/llms.txt", label: "LLM quick map", description: "What SkillFlux measures, every skill's headline result, citation rules, then the source directory." },
  { path: "/llms-full.txt", label: "Full text", description: "Every skill with summary, license, commit and results, plus the complete source directory." },
  { path: "/data/index.json", label: "Dataset manifest", description: "Every data file (JSON, CSV, JSON Schema) with size and sha256. CC BY 4.0." },
  { path: "/index.json", label: "JSON index", description: "Skills with results, benchmark runs, and directory sources in one structured file." },
  { path: "/feed.xml", label: "RSS feed", description: "New benchmark reports, new sources and skill deep-dives." },
  { path: "/benchmarks/feed.xml", label: "Benchmarks RSS", description: "One item per skill in each published benchmark run." },
  { path: "/insights/feed.xml", label: "Insights RSS", description: "Editorial skill deep-dives (in Chinese); analysis, not measurements." },
  { path: "/scenarios/index.json", label: "Scenarios", description: "Task-based guides for choosing a skill source." }
] as const;
