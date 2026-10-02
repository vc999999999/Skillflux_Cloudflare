import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  getAlternateLanguagePath,
  getPageCopy,
  getSiteCopy,
  localizePath,
  translateScale,
  translateSiteName
} from "../src/lib/i18n";

describe("SkillFlux i18n", () => {
  it("supports Chinese and English page copy", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["zh", "en"]);
    expect(getPageCopy("zh").nav.directory).toBe("目录");
    expect(getPageCopy("en").nav.directory).toBe("Directory");
  });

  it("keeps Chinese on root paths and prefixes English paths", () => {
    expect(localizePath("/", "zh")).toBe("/");
    expect(localizePath("/directory/", "zh")).toBe("/directory/");
    expect(localizePath("/", "en")).toBe("/en/");
    expect(localizePath("/directory/", "en")).toBe("/en/directory/");
    expect(localizePath("/site/modelscope-cn-skills/", "en")).toBe("/en/site/modelscope-cn-skills/");
  });

  it("maps between alternate language paths for the same page", () => {
    expect(getAlternateLanguagePath("/directory/", "en")).toBe("/en/directory/");
    expect(getAlternateLanguagePath("/en/directory/", "zh")).toBe("/directory/");
    expect(getAlternateLanguagePath("/en/site/modelscope-cn-skills/", "zh")).toBe("/site/modelscope-cn-skills/");
  });

  it("translates Chinese site names and scale in English mode", () => {
    expect(translateSiteName("魔搭 ModelScope Skills", "en")).toBe("ModelScope Skills");
    expect(translateSiteName("魔搭 ModelScope Skills", "zh")).toBe("魔搭 ModelScope Skills");
    expect(translateSiteName("阿里云 Skills", "en")).toBe("Alibaba Cloud Skills");
    expect(translateSiteName("腾讯云 SkillHub", "en")).toBe("Tencent Cloud SkillHub");
    expect(translateSiteName("Android Skills(官方)", "en")).toBe("Android Skills (Official)");
    expect(translateSiteName("Expo Skills(官方)", "en")).toBe("Expo Skills (Official)");
    expect(translateSiteName("everything-claude-code 中文版", "en")).toBe("everything-claude-code (Chinese Edition)");
    expect(translateSiteName("接口 AI Skills", "en")).toBe("Jiekou AI Skills");

    expect(translateScale("合集(企业)", "en")).toBe("Enterprise collection");

    const sampleSite = {
      id: "modelscope-cn-skills",
      slug: "modelscope-cn-skills",
      resourceSlug: "modelscope-skills",
      indexable: true,
      name: "魔搭 ModelScope Skills",
      canonicalUrl: "https://modelscope.cn",
      displayUrl: "modelscope.cn",
      tags: ["Agent Skills", "推荐", "合集"],
      category: "marketplace",
      language: ["zh"],
      region: "cn",
      type: "skill 合集",
      kinds: ["skill"] as ("skill" | "mcp" | "plugin")[],
      scale: "合集(企业)",
      pricing: "free" as const,
      tagline: "中文能力发现",
      summary: "魔搭能力目录",
      aiSummary: "AI summary",
      featured: false,
      recommended: true,
      trustLevel: "high" as const,
      status: "active" as const,
      sourceUrls: ["https://modelscope.cn"],
      addedAt: "2026-01-01",
      updatedAt: "2026-01-01"
    };
    const enCopy = getSiteCopy(sampleSite, "en");
    expect(enCopy.name).toBe("ModelScope Skills");
    expect(enCopy.scale).toBe("Enterprise collection");
  });
});

