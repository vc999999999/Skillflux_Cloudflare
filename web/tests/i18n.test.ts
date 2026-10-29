import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  langStaticPaths,
  stripLanguagePrefix,
  getAlternateLanguagePath,
  getPageCopy,
  getSiteCopy,
  localizePath,
  translateScale,
  translateSiteName
} from "../src/lib/i18n";

describe("SkillFlux i18n", () => {
  it("supports English and Chinese page copy, English first", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en", "zh"]);
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(getPageCopy("zh").nav.directory).toBe("目录");
    expect(getPageCopy("en").nav.directory).toBe("Directory");
  });

  it("keeps English on root paths and prefixes Chinese paths", () => {
    expect(localizePath("/", "en")).toBe("/");
    expect(localizePath("/directory/", "en")).toBe("/directory/");
    expect(localizePath("/", "zh")).toBe("/zh/");
    expect(localizePath("/directory/", "zh")).toBe("/zh/directory/");
    expect(localizePath("/zh/", "en")).toBe("/");
    expect(localizePath("/zh/directory/", "zh")).toBe("/zh/directory/");
    // The retired /en/ prefix is understood but never produced.
    expect(localizePath("/en/directory/", "en")).toBe("/directory/");
    expect(localizePath("/en/", "zh")).toBe("/zh/");
  });

  it("maps between alternate language paths for the same page", () => {
    expect(getAlternateLanguagePath("/directory/", "zh")).toBe("/zh/directory/");
    expect(getAlternateLanguagePath("/zh/directory/", "en")).toBe("/directory/");
    expect(getAlternateLanguagePath("/zh/resource/modelscope-skills/", "en")).toBe("/resource/modelscope-skills/");
    expect(stripLanguagePrefix("/zh")).toBe("/");
    expect(stripLanguagePrefix("/zhuanlan/")).toBe("/zhuanlan/");
  });

  it("generates one static path per language", () => {
    expect(langStaticPaths()).toEqual([
      { params: { lang: undefined }, props: { lang: "en" } },
      { params: { lang: "zh" }, props: { lang: "zh" } }
    ]);
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

