import categoriesData from "../../data/categories.json";
import sitesData from "../../data/sites.json";
import { ENDPOINTS, SITE } from "../config";

export type Category = {
  slug: string;
  label: string;
  shortLabel: string;
  description: string;
  priority: number;
};

export type TrustLevel = "high" | "medium" | "emerging";
export type SiteStatus = "active" | "watching" | "archived";
export type Pricing = "free" | "mixed" | "paid";

export type Site = {
  id: string;
  slug: string;
  name: string;
  canonicalUrl: string;
  displayUrl: string;
  category: string;
  tags: string[];
  language: string[];
  region: string;
  type: string;
  scale: string;
  pricing: Pricing;
  tagline: string;
  summary: string;
  aiSummary: string;
  featured: boolean;
  trustLevel: TrustLevel;
  status: SiteStatus;
  sourceUrls: string[];
  addedAt: string;
  updatedAt: string;
};

export type Catalog = {
  categories: Category[];
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
    categories: number;
    featured: number;
  };
  endpoints: typeof ENDPOINTS;
  categories: Array<Category & { count: number }>;
  sites: Site[];
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const allowedPricing = new Set<Pricing>(["free", "mixed", "paid"]);
const allowedTrustLevels = new Set<TrustLevel>(["high", "medium", "emerging"]);
const allowedStatuses = new Set<SiteStatus>(["active", "watching", "archived"]);

let cachedCatalog: Catalog | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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

function requireNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key];
  assert(typeof value === "number" && Number.isFinite(value), `${context}.${key} must be a finite number`);
  return value;
}

function requireStringArray(record: Record<string, unknown>, key: string, context: string): string[] {
  const value = record[key];
  assert(Array.isArray(value), `${context}.${key} must be an array`);
  assert(value.every((item) => typeof item === "string" && item.trim().length > 0), `${context}.${key} must contain strings`);
  return value.map((item) => item.trim());
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

function normalizeCategory(raw: unknown, index: number): Category {
  const context = `categories[${index}]`;
  assert(isRecord(raw), `${context} must be an object`);

  return {
    slug: requireString(raw, "slug", context),
    label: requireString(raw, "label", context),
    shortLabel: requireString(raw, "shortLabel", context),
    description: requireString(raw, "description", context),
    priority: requireNumber(raw, "priority", context)
  };
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

  return {
    id: requireString(raw, "id", context),
    slug: requireString(raw, "slug", context),
    name: requireString(raw, "name", context),
    canonicalUrl,
    displayUrl: requireString(raw, "displayUrl", context),
    category: requireString(raw, "category", context),
    tags: requireStringArray(raw, "tags", context),
    language: requireStringArray(raw, "language", context),
    region: requireString(raw, "region", context),
    type: requireString(raw, "type", context),
    scale: requireString(raw, "scale", context),
    pricing,
    tagline: requireString(raw, "tagline", context),
    summary: requireString(raw, "summary", context),
    aiSummary: requireString(raw, "aiSummary", context),
    featured: requireBoolean(raw, "featured", context),
    trustLevel,
    status,
    sourceUrls,
    addedAt: requireDate(requireString(raw, "addedAt", context), `${context}.addedAt`),
    updatedAt: requireDate(requireString(raw, "updatedAt", context), `${context}.updatedAt`)
  };
}

function compareFeaturedThenName(a: Site, b: Site): number {
  if (a.featured !== b.featured) return a.featured ? -1 : 1;
  return a.name.localeCompare(b.name, "zh-CN");
}

export function validateCatalog(): Catalog {
  const categories = (categoriesData as unknown[]).map(normalizeCategory).sort((a, b) => a.priority - b.priority);
  const sites = (sitesData as unknown[]).map(normalizeSite);
  const categorySlugs = new Set(categories.map((category) => category.slug));
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const category of categories) {
    assert(!slugs.has(`category:${category.slug}`), `duplicate category slug: ${category.slug}`);
    slugs.add(`category:${category.slug}`);
  }

  for (const site of sites) {
    assert(!ids.has(site.id), `duplicate site id: ${site.id}`);
    assert(!slugs.has(site.slug), `duplicate site slug: ${site.slug}`);
    assert(categorySlugs.has(site.category), `${site.slug} references unknown category ${site.category}`);
    ids.add(site.id);
    slugs.add(site.slug);
  }

  assert(sites.length >= 50, "catalog must contain at least 50 sites");
  assert(sites.some((site) => site.featured), "catalog must contain featured sites");

  cachedCatalog = {
    categories,
    sites: [...sites].sort(compareFeaturedThenName)
  };
  return cachedCatalog;
}

function getCatalog(): Catalog {
  return cachedCatalog ?? validateCatalog();
}

export function getCategories(): Category[] {
  return getCatalog().categories;
}

export function getSites(): Site[] {
  return getCatalog().sites;
}

export function getFeaturedSites(limit?: number): Site[] {
  const featured = getSites().filter((site) => site.featured);
  return typeof limit === "number" ? featured.slice(0, limit) : featured;
}

export function getCategoryBySlug(slug: string): Category | undefined {
  return getCategories().find((category) => category.slug === slug);
}

export function getSiteBySlug(slug: string): Site | undefined {
  return getSites().find((site) => site.slug === slug);
}

export function getSitesByCategory(slug: string): Site[] {
  return getSites().filter((site) => site.category === slug);
}

export function getCategoriesWithCounts(): Array<Category & { count: number }> {
  const sites = getSites();
  return getCategories().map((category) => ({
    ...category,
    count: sites.filter((site) => site.category === category.slug).length
  }));
}

export function getDirectoryStats() {
  const sites = getSites();
  const updatedAt = sites.reduce((latest, site) => (site.updatedAt > latest ? site.updatedAt : latest), "1970-01-01");

  return {
    resourceCount: sites.length,
    categoryCount: getCategories().length,
    featuredCount: sites.filter((site) => site.featured).length,
    updatedAt
  };
}

export function buildIndexPayload(generatedAt = new Date().toISOString()): IndexPayload {
  const sites = getSites();
  const categories = getCategoriesWithCounts();

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
      categories: categories.length,
      featured: sites.filter((site) => site.featured).length
    },
    endpoints: ENDPOINTS,
    categories,
    sites
  };
}

export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE.url).toString();
}

export function renderLlmsText(generatedAt = new Date().toISOString()): string {
  const stats = getDirectoryStats();
  const featured = getFeaturedSites(12);
  const categories = getCategoriesWithCounts();

  return [
    "# SkillFlux 技流",
    "",
    SITE.description,
    "",
    `Generated: ${generatedAt}`,
    `Resources: ${stats.resourceCount}`,
    `Updated: ${stats.updatedAt}`,
    "",
    "## Main Categories",
    ...categories.map((category) => `- ${category.label} (${category.slug}): ${category.description} Count: ${category.count}`),
    "",
    "## Featured Entrypoints",
    ...featured.map((site) => `- ${site.name}: ${site.tagline} ${absoluteUrl(`/site/${site.slug}/`)}`),
    "",
    "## Machine-readable endpoints",
    ...ENDPOINTS.map((endpoint) => `- ${endpoint.path}: ${endpoint.description}`),
    "",
    "Use /llms-full.txt for the complete plain-text catalog and /index.json for structured data."
  ].join("\n");
}

export function renderLlmsFullText(generatedAt = new Date().toISOString()): string {
  const categories = getCategoriesWithCounts();
  const lines = [
    "# SkillFlux 技流完整目录",
    "",
    SITE.description,
    "",
    `Generated: ${generatedAt}`,
    `Schema Version: ${SITE.schemaVersion}`,
    ""
  ];

  for (const category of categories) {
    lines.push(`## ${category.label} (${category.slug})`, category.description, "");
    for (const site of getSitesByCategory(category.slug)) {
      lines.push(
        `### ${site.name}`,
        `URL: ${site.canonicalUrl}`,
        `Type: ${site.type}`,
        `Scale: ${site.scale}`,
        `Language: ${site.language.join(", ")}`,
        `Tags: ${site.tags.join(", ")}`,
        `Tagline: ${site.tagline}`,
        `Summary: ${site.summary}`,
        `AI Summary: ${site.aiSummary}`,
        `Updated: ${site.updatedAt}`,
        ""
      );
    }
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
  return [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${absoluteUrl("/sitemap-index.xml")}`,
    `Sitemap: ${absoluteUrl("/sitemap-0.xml")}`
  ].join("\n");
}
