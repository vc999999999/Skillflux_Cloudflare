import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  getAlternateLanguagePath,
  getPageCopy,
  localizePath
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
});
