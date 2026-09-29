import { describe, expect, it } from "vitest";
import {
  buildIndexPayload,
  getCategories,
  getDirectoryStats,
  getFeaturedSites,
  getPopularTags,
  getSites,
  renderLlmsFullText,
  validateCatalog
} from "../src/lib/content";

// Representative entries that must stay after curating down to a source/repo directory.
const keptUrls = [
  "https://modelscope.cn/skills",
  "https://github.com/anthropics/skills",
  "https://github.com/obra/superpowers",
  "https://github.com/ComposioHQ/awesome-claude-skills",
  "https://tessl.io/registry",
  "https://skills.sh/"
].map((url) => new URL(url).toString());

// Single skills and niche entries were intentionally removed in the pivot.
const removedUrls = [
  "https://skills.aliyun.com/skills/alibabacloud-iqs-weather-query",
  "https://www.skills.sh/qu-skills/skills/ai-video-generation",
  "https://github.com/gccszs/disk-cleaner",
  "https://qoder.com/marketplace/skill?id=official_y6w8EaWN"
].map((url) => new URL(url).toString());

describe("SkillFlux catalog", () => {
  it("is a curated source/repo catalog with unique ids, slugs, and urls", () => {
    const catalog = validateCatalog();
    const ids = new Set(catalog.sites.map((site) => site.id));
    const slugs = new Set(catalog.sites.map((site) => site.slug));
    const urls = new Set(catalog.sites.map((site) => site.canonicalUrl));

    expect(catalog.sites.length).toBeGreaterThanOrEqual(30);
    expect(ids.size).toBe(catalog.sites.length);
    expect(slugs.size).toBe(catalog.sites.length);
    for (const url of keptUrls) {
      expect(urls.has(url)).toBe(true);
    }
    for (const url of removedUrls) {
      expect(urls.has(url)).toBe(false);
    }
  });

  it("uses tags as public labels and derives a fixed category per site", () => {
    const catalog = validateCatalog();
    const tags = getPopularTags();
    const categories = getCategories();
    const categorySlugs = new Set(categories.map((category) => category.slug));

    expect(tags.length).toBeGreaterThanOrEqual(8);
    for (const site of catalog.sites) {
      expect(site.tags.length).toBeGreaterThan(0);
      expect(categorySlugs.has(site.category)).toBe(true);
    }

    // Category counts must add up to the full catalog (every site lands in exactly one).
    const totalCategorized = categories.reduce((sum, category) => sum + category.count, 0);
    expect(totalCategorized).toBe(catalog.sites.length);
  });

  it("groups every source under a known source-type category", () => {
    const categories = getCategories();
    const knownSlugs = new Set(categories.map((category) => category.slug));

    for (const category of categories) {
      expect(category.count).toBeGreaterThan(0);
    }
    for (const site of getSites()) {
      expect(knownSlugs.has(site.category)).toBe(true);
    }
  });

  it("pins the annotated ModelScope skills directory as the first recommended resource", () => {
    const [first] = getSites();

    expect(first.canonicalUrl).toBe(new URL("https://modelscope.cn/skills").toString());
    expect(first.name).toContain("ModelScope");
    expect(first.recommended).toBe(true);
    expect(first.tags).toContain("推荐");
  });

  it("computes directory stats from source data", () => {
    const stats = getDirectoryStats();

    expect(stats.resourceCount).toBe(getSites().length);
    expect(stats.labelCount).toBe(getPopularTags().length);
    expect(stats.featuredCount).toBe(getFeaturedSites().length);
    expect(stats.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("builds an agent-readable JSON payload with counts and schema version", () => {
    const payload = buildIndexPayload("2026-06-24T00:00:00.000Z");

    expect(payload.schemaVersion).toBe("2026-06-24");
    expect(payload.generatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(payload.counts.resources).toBe(getSites().length);
    expect(payload.counts.labels).toBe(getPopularTags().length);
    expect(payload.sites[0]).toHaveProperty("canonicalUrl");
    expect(payload.labels[0]).toHaveProperty("tag");
  });

  it("renders full LLM text that includes every resource name", () => {
    const text = renderLlmsFullText("2026-06-24T00:00:00.000Z");

    expect(text).toContain("# SkillFlux 技流完整目录");
    expect(text).toContain("## 标签");
    for (const site of getSites()) {
      expect(text).toContain(site.name);
    }
  });
});
