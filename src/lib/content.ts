import sitesData from "../../data/sites.json";
import categoriesData from "../../data/categories.json";
import { ENDPOINTS, SITE } from "../config";
import { translateTag } from "./i18n";
import { getGuides } from "./guides";

export type TrustLevel = "high" | "medium" | "emerging";
export type SiteStatus = "active" | "watching" | "archived";
export type Pricing = "free" | "mixed" | "paid";

export type Faq = {
  q: string;
  a: string;
};

export type Site = {
  id: string;
  slug: string;
  name: string;
  canonicalUrl: string;
  displayUrl: string;
  tags: string[];
  category: string;
  language: string[];
  region: string;
  type: string;
  scale: string;
  pricing: Pricing;
  tagline: string;
  summary: string;
  // Optional 100-200 word editorial write-up. Falls back to `summary` when absent.
  longSummary?: string;
  aiSummary: string;
  // Optional hand-written FAQ. Falls back to auto-generated questions when absent.
  faqs?: Faq[];
  featured: boolean;
  recommended: boolean;
  trustLevel: TrustLevel;
  status: SiteStatus;
  sourceUrls: string[];
  addedAt: string;
  updatedAt: string;
};

export type CatalogLabel = {
  tag: string;
  count: number;
};

export type CategoryMeta = {
  slug: string;
  label: string;
  shortLabel: string;
  description: string;
  priority: number;
};

export type CategoryWithCount = CategoryMeta & { count: number };

export type Catalog = {
  labels: CatalogLabel[];
  sites: Site[];
};

type IndexPayload = {
  schemaVersion: string;
  generatedAt: string;
  site: {
    name: string;
    url: string;
    description: string;
  };
  counts: {
    resources: number;
    labels: number;
    featured: number;
    recommended: number;
  };
  endpoints: typeof ENDPOINTS;
  labels: CatalogLabel[];
  sites: Site[];
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const allowedPricing = new Set<Pricing>(["free", "mixed", "paid"]);
const allowedTrustLevels = new Set<TrustLevel>(["high", "medium", "emerging"]);
const allowedStatuses = new Set<SiteStatus>(["active", "watching", "archived"]);

let cachedCatalog: Catalog | undefined;
let cachedCategories: CategoryMeta[] | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function loadCategories(): CategoryMeta[] {
  if (cachedCategories) return cachedCategories;
  const raw = categoriesData as unknown[];
  const slugs = new Set<string>();
  const categories = raw.map((item, index) => {
    const context = `categories[${index}]`;
    assert(isRecord(item), `${context} must be an object`);
    const slug = requireString(item, "slug", context);
    const priority = item.priority;
    assert(typeof priority === "number", `${context}.priority must be a number`);
    assert(!slugs.has(slug), `duplicate category slug: ${slug}`);
    slugs.add(slug);
    return {
      slug,
      label: requireString(item, "label", context),
      shortLabel: requireString(item, "shortLabel", context),
      description: requireString(item, "description", context),
      priority
    } satisfies CategoryMeta;
  });
  categories.sort((a, b) => a.priority - b.priority);
  cachedCategories = categories;
  return categories;
}

function categorySlugSet(): Set<string> {
  return new Set(loadCategories().map((category) => category.slug));
}

function requireCategory(record: Record<string, unknown>, context: string): string {
  const value = requireString(record, "category", context);
  assert(categorySlugSet().has(value), `${context}.category "${value}" is not defined in data/categories.json`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  assert(typeof value === "string" && value.trim().length > 0, `${context}.${key} must be a non-empty string`);
  return value.trim();
}

function requireBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
  const value = record[key];
  assert(typeof value === "boolean", `${context}.${key} must be boolean`);
  return value;
}

function requireStringArray(record: Record<string, unknown>, key: string, context: string): string[] {
  const value = record[key];
  assert(Array.isArray(value), `${context}.${key} must be an array`);
  assert(value.every((item) => typeof item === "string" && item.trim().length > 0), `${context}.${key} must contain strings`);
  return value.map((item) => item.trim());
}

function optionalString(record: Record<string, unknown>, key: string, context: string): string | undefined {
  if (!(key in record) || record[key] === undefined || record[key] === null) return undefined;
  return requireString(record, key, context);
}

function optionalFaqs(record: Record<string, unknown>, context: string): Faq[] | undefined {
  const value = record.faqs;
  if (value === undefined || value === null) return undefined;
  assert(Array.isArray(value), `${context}.faqs must be an array`);
  return value.map((item, index) => {
    const itemContext = `${context}.faqs[${index}]`;
    assert(isRecord(item), `${itemContext} must be an object`);
    return {
      q: requireString(item, "q", itemContext),
      a: requireString(item, "a", itemContext)
    } satisfies Faq;
  });
}

function requireUrl(value: string, context: string): string {
  try {
    const url = new URL(value);
    assert(url.protocol === "https:", `${context} must use https`);
    return url.toString();
  } catch {
    throw new Error(`${context} must be a valid URL`);
  }
}

function requireDate(value: string, context: string): string {
  assert(datePattern.test(value), `${context} must use YYYY-MM-DD`);
  assert(!Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), `${context} must be a valid date`);
  return value;
}

function normalizeSite(raw: unknown, index: number): Site {
  const context = `sites[${index}]`;
  assert(isRecord(raw), `${context} must be an object`);

  const pricing = requireString(raw, "pricing", context) as Pricing;
  const trustLevel = requireString(raw, "trustLevel", context) as TrustLevel;
  const status = requireString(raw, "status", context) as SiteStatus;
  assert(allowedPricing.has(pricing), `${context}.pricing has unsupported value`);
  assert(allowedTrustLevels.has(trustLevel), `${context}.trustLevel has unsupported value`);
  assert(allowedStatuses.has(status), `${context}.status has unsupported value`);

  const canonicalUrl = requireUrl(requireString(raw, "canonicalUrl", context), `${context}.canonicalUrl`);
  const sourceUrls = requireStringArray(raw, "sourceUrls", context).map((url, urlIndex) =>
    requireUrl(url, `${context}.sourceUrls[${urlIndex}]`)
  );
  const tags = requireStringArray(raw, "tags", context);
  const type = requireString(raw, "type", context);
  const longSummary = optionalString(raw, "longSummary", context);
  const faqs = optionalFaqs(raw, context);

  return {
    id: requireString(raw, "id", context),
    slug: requireString(raw, "slug", context),
    name: requireString(raw, "name", context),
    canonicalUrl,
    displayUrl: requireString(raw, "displayUrl", context),
    tags,
    category: requireCategory(raw, context),
    language: requireStringArray(raw, "language", context),
    region: requireString(raw, "region", context),
    type,
    scale: requireString(raw, "scale", context),
    pricing,
    tagline: requireString(raw, "tagline", context),
    summary: requireString(raw, "summary", context),
    ...(longSummary ? { longSummary } : {}),
    aiSummary: requireString(raw, "aiSummary", context),
    ...(faqs ? { faqs } : {}),
    featured: requireBoolean(raw, "featured", context),
    recommended: requireBoolean(raw, "recommended", context),
    trustLevel,
    status,
    sourceUrls,
    addedAt: requireDate(requireString(raw, "addedAt", context), `${context}.addedAt`),
    updatedAt: requireDate(requireString(raw, "updatedAt", context), `${context}.updatedAt`)
  };
}

function compareSites(a: Site, b: Site): number {
  if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
  if (a.featured !== b.featured) return a.featured ? -1 : 1;
  return a.name.localeCompare(b.name, "zh-CN");
}

function buildLabels(sites: Site[]): CatalogLabel[] {
  const counts = new Map<string, number>();
  for (const site of sites) {
    for (const tag of site.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

export function validateCatalog(): Catalog {
  const sites = (sitesData as unknown[]).map(normalizeSite);
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const urls = new Set<string>();

  for (const site of sites) {
    assert(!ids.has(site.id), `duplicate site id: ${site.id}`);
    assert(!slugs.has(site.slug), `duplicate site slug: ${site.slug}`);
    assert(!urls.has(site.canonicalUrl), `duplicate site URL: ${site.canonicalUrl}`);
    assert(site.tags.length > 0, `${site.slug} must have at least one tag`);
    ids.add(site.id);
    slugs.add(site.slug);
    urls.add(site.canonicalUrl);
  }

  assert(sites.length >= 30, "catalog must contain at least 30 sites");
  assert(sites.some((site) => site.featured), "catalog must contain featured sites");
  assert(sites.some((site) => site.recommended), "catalog must contain a recommended site");

  const sortedSites = [...sites].sort(compareSites);
  cachedCatalog = {
    labels: buildLabels(sortedSites),
    sites: sortedSites
  };
  return cachedCatalog;
}

function getCatalog(): Catalog {
  return cachedCatalog ?? validateCatalog();
}

export function getPopularTags(limit?: number): CatalogLabel[] {
  const labels = getCatalog().labels;
  return typeof limit === "number" ? labels.slice(0, limit) : labels;
}

// Source-type categories (官方厂商 / 市场 / 开源仓库 / 社区 / 综合目录) with live counts.
export function getCategories(): CategoryWithCount[] {
  const sites = getSites();
  return loadCategories().map((category) => ({
    ...category,
    count: sites.filter((site) => site.category === category.slug).length
  }));
}

export function getSites(): Site[] {
  return getCatalog().sites;
}

export function getFeaturedSites(limit?: number): Site[] {
  const featured = getSites().filter((site) => site.featured || site.recommended);
  return typeof limit === "number" ? featured.slice(0, limit) : featured;
}

export function getSiteBySlug(slug: string): Site | undefined {
  return getSites().find((site) => site.slug === slug);
}

export function getRelatedSites(site: Site, limit = 4): Site[] {
  const sourceTags = new Set(site.tags);
  return getSites()
    .filter((candidate) => candidate.slug !== site.slug)
    .map((candidate) => ({
      candidate,
      score: candidate.tags.filter((tag) => sourceTags.has(tag)).length
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareSites(a.candidate, b.candidate))
    .slice(0, limit)
    .map((item) => item.candidate);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type TagIndexEntry = {
  tag: string;
  slug: string;
  count: number;
  sites: Site[];
};

let cachedTagIndex: TagIndexEntry[] | undefined;

// Stable, URL-friendly tag routes. Prefer the English label (e.g. 合集 -> collection);
// fall back to a slug of the raw tag, then to an encoded value so every tag is routable.
export function getTagIndex(): TagIndexEntry[] {
  if (cachedTagIndex) return cachedTagIndex;
  const sites = getSites();
  const usedSlugs = new Set<string>();
  const entries = getPopularTags().map((label, index) => {
    // Prefer the English label; fall back to a stable ASCII token so every tag stays routable.
    const base = slugify(translateTag(label.tag, "en")) || slugify(label.tag) || `tag-${index + 1}`;
    let slug = base;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${suffix++}`;
    }
    usedSlugs.add(slug);
    return {
      tag: label.tag,
      slug,
      count: label.count,
      sites: sites.filter((site) => site.tags.includes(label.tag))
    } satisfies TagIndexEntry;
  });
  cachedTagIndex = entries;
  return entries;
}

export function getTagBySlug(slug: string): TagIndexEntry | undefined {
  return getTagIndex().find((entry) => entry.slug === slug);
}

export function getSitesByCategory(slug: string): Site[] {
  return getSites().filter((site) => site.category === slug);
}

export function getCategoryBySlug(slug: string): CategoryWithCount | undefined {
  return getCategories().find((category) => category.slug === slug);
}

export function getDirectoryStats() {
  const sites = getSites();
  const updatedAt = sites.reduce((latest, site) => (site.updatedAt > latest ? site.updatedAt : latest), "1970-01-01");

  return {
    resourceCount: sites.length,
    labelCount: getPopularTags().length,
    featuredCount: sites.filter((site) => site.featured || site.recommended).length,
    recommendedCount: sites.filter((site) => site.recommended).length,
    updatedAt
  };
}

export function buildIndexPayload(generatedAt = new Date().toISOString()): IndexPayload {
  const sites = getSites();
  const labels = getPopularTags();

  return {
    schemaVersion: SITE.schemaVersion,
    generatedAt,
    site: {
      name: SITE.name,
      url: SITE.url,
      description: SITE.description
    },
    counts: {
      resources: sites.length,
      labels: labels.length,
      featured: sites.filter((site) => site.featured || site.recommended).length,
      recommended: sites.filter((site) => site.recommended).length
    },
    endpoints: ENDPOINTS,
    labels,
    sites
  };
}

export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE.url).toString();
}

export function renderLlmsText(generatedAt = new Date().toISOString()): string {
  const stats = getDirectoryStats();
  const featured = getFeaturedSites(12);
  const labels = getPopularTags(16);
  const categories = getCategories();
  const tagIndex = getTagIndex().slice(0, 16);

  return [
    "# SkillFlux 技流",
    "",
    SITE.description,
    "",
    `Generated: ${generatedAt}`,
    `Resources: ${stats.resourceCount}`,
    `Labels: ${stats.labelCount}`,
    `Updated: ${stats.updatedAt}`,
    "",
    "## Main Labels",
    ...labels.map((label) => `- ${label.tag}: ${label.count}`),
    "",
    "## Featured Entrypoints",
    ...featured.map((site) => `- ${site.recommended ? "[推荐] " : ""}${site.name}: ${site.tagline} ${absoluteUrl(`/site/${site.slug}/`)}`),
    "",
    "## Browse by source type",
    ...categories.map((category) => `- ${category.label} (${category.count}): ${absoluteUrl(`/category/${category.slug}/`)}`),
    "",
    "## Browse by tag",
    ...tagIndex.map((entry) => `- ${entry.tag} (${entry.count}): ${absoluteUrl(`/tag/${entry.slug}/`)}`),
    "",
    "## Guides",
    ...getGuides().map((guide) => `- ${guide.title.zh}: ${guide.description.zh} ${absoluteUrl(`/guides/${guide.slug}/`)}`),
    "",
    "## Machine-readable endpoints",
    ...ENDPOINTS.map((endpoint) => `- ${endpoint.path}: ${endpoint.description}`),
    "",
    "Use /llms-full.txt for the complete plain-text catalog and /index.json for structured data."
  ].join("\n");
}

export function renderLlmsFullText(generatedAt = new Date().toISOString()): string {
  const labels = getPopularTags();
  const lines = [
    "# SkillFlux 技流完整目录",
    "",
    SITE.description,
    "",
    `Generated: ${generatedAt}`,
    `Schema Version: ${SITE.schemaVersion}`,
    "",
    "## 标签",
    ...labels.map((label) => `- ${label.tag}: ${label.count}`),
    "",
    "## 完整资源",
    ""
  ];

  for (const site of getSites()) {
    lines.push(
      `### ${site.recommended ? "[推荐] " : ""}${site.name}`,
      `URL: ${site.canonicalUrl}`,
      `Type: ${site.type}`,
      `Scale: ${site.scale}`,
      `Language: ${site.language.join(", ")}`,
      `Tags: ${site.tags.join(", ")}`,
      `Tagline: ${site.tagline}`,
      `Summary: ${site.summary}`,
      ...(site.longSummary ? [`Details: ${site.longSummary.replace(/\n+/g, " ")}`] : []),
      `AI Summary: ${site.aiSummary}`,
      `Updated: ${site.updatedAt}`,
      ""
    );
  }

  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderFeedXml(generatedAt = new Date().toISOString()): string {
  const items = getSites()
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30)
    .map((site) => {
      const pageUrl = absoluteUrl(`/site/${site.slug}/`);
      return [
        "    <item>",
        `      <title>${escapeXml(site.name)}</title>`,
        `      <link>${escapeXml(pageUrl)}</link>`,
        `      <guid>${escapeXml(pageUrl)}</guid>`,
        `      <description>${escapeXml(`${site.tagline} ${site.summary}`)}</description>`,
        `      <pubDate>${new Date(`${site.updatedAt}T00:00:00.000Z`).toUTCString()}</pubDate>`,
        "    </item>"
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(SITE.name)}</title>`,
    `    <link>${escapeXml(SITE.url)}</link>`,
    `    <description>${escapeXml(SITE.description)}</description>`,
    `    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>"
  ].join("\n");
}

export function renderRobotsTxt(): string {
  // Explicitly welcome the crawlers that feed CN and global AI search.
  // The wildcard already allows everyone; the named blocks document intent
  // and reassure crawlers that check for their own user-agent.
  const crawlers = [
    // CN search / AI search indexes
    "Baiduspider", // 百度 → 文心 / 百度 AI 搜索
    "Sogou web spider", // 搜狗 → 腾讯元宝 / 微信搜一搜
    "360Spider", // 360 → 360 AI 搜索
    "YisouSpider", // 神马 → 夸克 AI
    "Bytespider", // 字节 → 豆包 / 头条 / 抖音
    // Global AI crawlers
    "GPTBot", // OpenAI / ChatGPT
    "OAI-SearchBot", // ChatGPT search
    "ChatGPT-User", // ChatGPT live fetch
    "ClaudeBot", // Anthropic / Claude
    "Claude-Web",
    "PerplexityBot", // Perplexity
    "Google-Extended", // Gemini / AI Overviews
    "Applebot-Extended", // Apple Intelligence
    "Bingbot", // Bing → Copilot
    "Amazonbot",
    "Meta-ExternalAgent"
  ];

  const lines = ["User-agent: *", "Allow: /", ""];
  for (const agent of crawlers) {
    lines.push(`User-agent: ${agent}`, "Allow: /", "");
  }
  lines.push(
    `Sitemap: ${absoluteUrl("/sitemap-index.xml")}`,
    `Sitemap: ${absoluteUrl("/sitemap-0.xml")}`
  );
  return lines.join("\n");
}
