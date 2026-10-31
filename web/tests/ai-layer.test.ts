import { describe, expect, it } from "vitest";
import { aiTaskIndex, aiTasks, claimsLedger, sourceMarkdown } from "../src/lib/ai-layer";
import { getIndexableSites } from "../src/lib/content";
import { getSourceAudits } from "../src/lib/source-audits";
import { alternativesFor, bestTopics, comparePairs, rankSites, sampleScore } from "../src/lib/source-compare";

describe("source comparisons", () => {
  it("lists each compare pair once, in a stable order, never pairing a source with itself", () => {
    const pairs = comparePairs();
    expect(new Set(pairs.map(pair => pair.slug)).size).toBe(pairs.length);
    for (const pair of pairs) {
      expect(pair.a.slug).not.toBe(pair.b.slug);
      expect(pair.a.resourceSlug.localeCompare(pair.b.resourceSlug)).toBeLessThan(0);
    }
  });

  it("never suggests a source as its own alternative", () => {
    for (const site of getIndexableSites()) expect(alternativesFor(site).map(item => item.slug)).not.toContain(site.slug);
  });

  it("ranks sampled sources before unsampled ones, by sample score", () => {
    for (const topic of bestTopics()) {
      const scores = rankSites(topic.sites).map(site => sampleScore(getSourceAudits().find(audit => audit.siteSlug === site.slug)));
      const firstNull = scores.indexOf(null);
      const sampled = (firstNull === -1 ? scores : scores.slice(0, firstNull)) as number[];
      expect(scores.slice(sampled.length).every(score => score === null)).toBe(true);
      expect([...sampled].sort((a, b) => b - a)).toEqual(sampled);
    }
  });
});

describe("agent layer", () => {
  it("indexes every task file it publishes", () => {
    expect(aiTaskIndex().tasks.map(task => task.task)).toEqual(aiTasks().map(doc => doc.task));
  });

  it("gives every claim an evidence URL and marks self-reported statements unverified", () => {
    const claims = claimsLedger();
    expect(new Set(claims.map(claim => claim.id)).size).toBe(claims.length);
    for (const claim of claims) {
      expect(claim.evidenceUrl).toMatch(/^https:\/\//);
      expect(claim.verified).toBe(claim.method !== "web-search");
    }
  });

  it("states in a website's Markdown that it was not sampled", () => {
    const website = getIndexableSites().find(site => !site.canonicalUrl.startsWith("https://github.com/"))!;
    expect(sourceMarkdown(website)).toContain("Not sampled: this is a website");
  });
});
