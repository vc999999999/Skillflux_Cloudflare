import { describe, expect, it } from "vitest";
import {
  buildIndexPayload,
  getCategories,
  getDirectoryStats,
  getFeaturedSites,
  getFilterableTags,
  getPopularTags,
  getSites,
  renderLlmsFullText,
  validateCatalog
} from "../src/lib/content";

const objectiveUrls = [
  "https://agent-skills.md/",
  "https://agentskill.sh/",
  "https://aitmpl.com/",
  "https://chompute-skills.s3.us-east-1.amazonaws.com/chompute-lpr.zip",
  "https://claude-plugins.dev/",
  "https://claudehub.cc/skills?seed=x14eqshh",
  "https://claudemarketplaces.com/",
  "https://clawhub.ai/",
  "https://discoveraiskills.com/",
  "https://github.com/OthmanAdi/planning-with-files",
  "https://github.com/anthropics/skills",
  "https://github.com/bradautomates/claude-video",
  "https://github.com/gccszs/disk-cleaner",
  "https://github.com/op7418/Humanizer-zh",
  "https://github.com/varunr89/resume-tailoring-skill",
  "https://hermes-agent.nousresearch.com/docs/zh-Hans/skills/",
  "https://llmskills.org/",
  "https://mcpmarket.com/zh/tools/skills/docker-patterns-6",
  "https://mcpmarket.com/zh/tools/skills/go-development-patterns-1777750088354",
  "https://mcpmarket.com/zh/tools/skills/go-testing-quality-2",
  "https://mcpmarket.com/zh/tools/skills/leaderboard",
  "https://mcpmarket.com/zh/tools/skills/postgresql-patterns-1777849920215",
  "https://mcpmarket.com/zh/tools/skills/python-patterns-best-practices-7",
  "https://mcpmarket.com/zh/tools/skills/python-testing-and-pytest-patterns",
  "https://model-context-protocol.com/servers/skills",
  "https://modelscope.cn/skills",
  "https://nanoskill.ai/skills",
  "https://qoder.com/marketplace/skill?id=official36467869",
  "https://qoder.com/marketplace/skill?id=official86382844",
  "https://qoder.com/marketplace/skill?id=official_5GXUhtdh",
  "https://qoder.com/marketplace/skill?id=official_BSzoPrW7",
  "https://qoder.com/marketplace/skill?id=official_y6w8EaWN",
  "https://qoder.com/marketplace/skill?id=official_zy1pr4a2",
  "https://qoder.com/zh/marketplace",
  "https://skillhub.cn/dashboard",
  "https://skills.aliyun.com/skills/alibabacloud-cli-guidance",
  "https://skills.aliyun.com/skills/alibabacloud-iqs-weather-query",
  "https://skills.aliyun.com/skills/alibabacloud-video-editor",
  "https://skills.aliyun.com/skills?orderBy=install",
  "https://skills.homes/zh-CN/categories",
  "https://skills.pub/zh",
  "https://skills.sh/",
  "https://skillsllm.com/",
  "https://skillsmp.com/",
  "https://skillstore.io/zh-hans",
  "https://skywork.ai/skillhub/zh/",
  "https://smithery.ai/skills",
  "https://tessl.io/registry",
  "https://www.claudeskillsmarket.com/",
  "https://www.everydev.ai/developers",
  "https://www.meyo123.com/community/square/skills",
  "https://www.npmjs.com/package/agent-skills-hub",
  "https://www.skillhub.club/",
  "https://www.skills.sh/agentspace-so/runcomfy-agent-skills/ai-music",
  "https://www.skills.sh/agentspace-so/runcomfy-agent-skills/face-swap",
  "https://www.skills.sh/agentspace-so/runcomfy-agent-skills/image-inpainting",
  "https://www.skills.sh/leonxlnx/taste-skill/gpt-taste",
  "https://www.skills.sh/mattpocock/skills/design-an-interface",
  "https://www.skills.sh/mattpocock/skills/teach",
  "https://www.skills.sh/microsoft/playwright-cli/playwright-cli",
  "https://www.skills.sh/qu-skills/skills/ai-image-generation",
  "https://www.skills.sh/qu-skills/skills/ai-video-generation",
  "https://www.skillsdirectory.com/"
].map((url) => new URL(url).toString());

describe("SkillFlux catalog", () => {
  it("contains every requested resource URL with unique IDs and slugs", () => {
    const catalog = validateCatalog();
    const ids = new Set(catalog.sites.map((site) => site.id));
    const slugs = new Set(catalog.sites.map((site) => site.slug));
    const urls = new Set(catalog.sites.map((site) => site.canonicalUrl));

    expect(catalog.sites.length).toBeGreaterThanOrEqual(objectiveUrls.length);
    expect(ids.size).toBe(catalog.sites.length);
    expect(slugs.size).toBe(catalog.sites.length);
    for (const url of objectiveUrls) {
      expect(urls.has(url)).toBe(true);
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

  it("excludes no-op universal tags from filterable labels", () => {
    const total = getSites().length;
    for (const label of getFilterableTags()) {
      expect(label.count).toBeLessThan(total);
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
