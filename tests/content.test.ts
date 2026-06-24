import { describe, expect, it } from "vitest";
import {
  buildIndexPayload,
  getCategories,
  getDirectoryStats,
  getFeaturedSites,
  getSites,
  renderLlmsFullText,
  validateCatalog
} from "../src/lib/content";

describe("SkillFlux catalog", () => {
  it("contains at least 50 valid resources with unique IDs and slugs", () => {
    const catalog = validateCatalog();
    const ids = new Set(catalog.sites.map((site) => site.id));
    const slugs = new Set(catalog.sites.map((site) => site.slug));

    expect(catalog.sites.length).toBeGreaterThanOrEqual(50);
    expect(ids.size).toBe(catalog.sites.length);
    expect(slugs.size).toBe(catalog.sites.length);
  });

  it("only references known categories and exposes visible category pages", () => {
    const catalog = validateCatalog();
    const categories = new Set(catalog.categories.map((category) => category.slug));

    expect(catalog.categories.length).toBeGreaterThanOrEqual(6);
    for (const site of catalog.sites) {
      expect(categories.has(site.category)).toBe(true);
    }
  });

  it("computes directory stats from source data", () => {
    const stats = getDirectoryStats();

    expect(stats.resourceCount).toBe(getSites().length);
    expect(stats.categoryCount).toBe(getCategories().length);
    expect(stats.featuredCount).toBe(getFeaturedSites().length);
    expect(stats.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("builds an agent-readable JSON payload with counts and schema version", () => {
    const payload = buildIndexPayload("2026-06-24T00:00:00.000Z");

    expect(payload.schemaVersion).toBe("2026-06-24");
    expect(payload.generatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(payload.counts.resources).toBe(getSites().length);
    expect(payload.counts.categories).toBe(getCategories().length);
    expect(payload.sites[0]).toHaveProperty("canonicalUrl");
  });

  it("renders full LLM text that includes every resource name", () => {
    const text = renderLlmsFullText("2026-06-24T00:00:00.000Z");

    expect(text).toContain("# SkillFlux 技流完整目录");
    for (const site of getSites()) {
      expect(text).toContain(site.name);
    }
  });
});
