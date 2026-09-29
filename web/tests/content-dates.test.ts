import { afterEach, describe, expect, it, vi } from 'vitest';
import sitesData from '../data/sites.json';
import editorialData from '../data/resource-editorial.json';
import type { ResourceEditorial } from '../src/lib/resource-editorial';

async function catalogFixture() {
  const sites = structuredClone(sitesData);
  const editorial: Record<string, ResourceEditorial> = structuredClone(editorialData);
  vi.resetModules();
  vi.doMock('../data/sites.json', () => ({ default: sites }));
  vi.doMock('../data/resource-editorial.json', () => ({ default: editorial }));
  const content = await import('../src/lib/content');
  return { sites, editorial, content };
}

afterEach(() => {
  vi.doUnmock('../data/sites.json');
  vi.doUnmock('../data/resource-editorial.json');
  vi.resetModules();
});

describe('resource content freshness', () => {
  it('keeps the latest source or editorial change and supports sources without editorial content', async () => {
    const { sites, editorial, content } = await catalogFixture();
    const [edited, sourceChanged, sourceOnly] = sites;
    edited!.updatedAt = '2026-06-24';
    editorial[edited!.slug]!.updatedAt = '2026-09-29';
    sourceChanged!.updatedAt = '2026-09-30';
    editorial[sourceChanged!.slug]!.updatedAt = '2026-09-01';
    sourceOnly!.updatedAt = '2026-09-28';
    delete editorial[sourceOnly!.slug];

    const catalog = content.validateCatalog();
    const dates = new Map(catalog.sites.map(site => [site.slug, site.updatedAt]));
    expect(dates.get(edited!.slug)).toBe('2026-09-29');
    expect(dates.get(sourceChanged!.slug)).toBe('2026-09-30');
    expect(dates.get(sourceOnly!.slug)).toBe('2026-09-28');
  });

  it('moves an editorial-only update into the RSS window and synchronizes JSON, LLM text and directory freshness', async () => {
    const { sites, editorial, content } = await catalogFixture();
    for (const site of sites) site.updatedAt = '2026-06-24';
    for (const entry of Object.values(editorial)) entry.updatedAt = '2026-09-01';
    const original = content.validateCatalog();
    const target = original.sites.at(-1)!;
    const url = content.absoluteUrl(`/resource/${target.resourceSlug}/`);
    const generatedAt = '2026-10-01T00:00:00.000Z';
    expect(content.renderFeedXml(generatedAt)).not.toContain(url);

    editorial[target.slug]!.updatedAt = '2026-09-30';
    content.validateCatalog();

    const firstItem = content.renderFeedXml(generatedAt).match(/<item>[\s\S]*?<\/item>/)![0];
    expect(firstItem).toContain(`<link>${url}</link>`);
    expect(firstItem).toContain('<pubDate>Wed, 30 Sep 2026 00:00:00 GMT</pubDate>');
    expect(content.buildIndexPayload(generatedAt).sites.find(site => site.slug === target.slug)?.updatedAt).toBe('2026-09-30');
    const llmEntry = content.renderLlmsFullText(generatedAt).split('\n### ').find(entry => entry.includes(`SkillFlux: ${url}\n`));
    expect(llmEntry).toContain('Updated: 2026-09-30');
    expect(content.getSites().find(site => site.slug === target.slug)?.updatedAt).toBe('2026-09-30');
    expect(content.getDirectoryStats().updatedAt).toBe('2026-09-30');
  });
});
