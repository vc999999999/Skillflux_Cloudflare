import { describe, expect, it } from 'vitest';
import { getSites } from '../src/lib/content';
import { collections, getEditorialSites, getSiteUseCases, useCases } from '../src/lib/editorial';
import { getGuideBySlug } from '../src/lib/guides';
import { matchesDirectoryRow, readDirectoryFilters, writeDirectoryFilters } from '../src/lib/directory-search';

describe('editorial discovery', () => {
  it('resolves every bilingual shortlist to unique real source records', () => {
    const sourceSlugs = new Set(getSites().map(site => site.slug));
    for (const entries of [useCases, collections]) {
      expect(new Set(entries.map(entry => entry.slug)).size).toBe(entries.length);
      for (const entry of entries) {
        expect(entry.title.zh).toBeTruthy();
        expect(entry.title.en).toBeTruthy();
        expect(entry.summary.zh).toBeTruthy();
        expect(entry.summary.en).toBeTruthy();
        expect(entry.siteSlugs.length).toBeGreaterThanOrEqual(3);
        expect(new Set(entry.siteSlugs).size).toBe(entry.siteSlugs.length);
        expect(entry.siteSlugs.every(slug => sourceSlugs.has(slug))).toBe(true);
        expect(getEditorialSites(entry).map(site => site.slug)).toEqual(entry.siteSlugs);
      }
    }
    expect(getSiteUseCases('github-com-android-skills').map(entry => entry.slug)).toContain('mobile');
    expect(getSiteUseCases('mcpservers-org').map(entry => entry.slug)).toContain('mcp');
  });

  it('keeps task pages substantial and every shortlist connected to real comparison sources and guides', () => {
    for (const entry of [...useCases, ...collections]) {
      expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.details).toBeDefined();
      expect(entry.details.overview.length).toBeGreaterThanOrEqual(2);
      expect(entry.details.audience.zh).toBeTruthy();
      expect(entry.details.audience.en).toBeTruthy();
      expect(entry.details.selection.zh).toBeTruthy();
      expect(entry.details.selection.en).toBeTruthy();
      expect(entry.details.comparisons.map(row => row.siteSlug)).toEqual(entry.siteSlugs);
      for (const row of entry.details.comparisons) {
        for (const lang of ['zh', 'en'] as const) {
          expect(row.role[lang]).toBeTruthy();
          expect(row.tradeoff[lang]).toBeTruthy();
        }
      }
      expect(entry.details.relatedGuides.length).toBeGreaterThan(0);
      expect(entry.details.relatedGuides.every(slug => getGuideBySlug(slug))).toBe(true);
      const crossLinks = (useCases.includes(entry as typeof useCases[number]) ? collections : useCases)
        .filter(candidate => candidate.siteSlugs.some(slug => entry.siteSlugs.includes(slug)));
      expect(crossLinks.length).toBeGreaterThan(0);
    }
    for (const entry of useCases) {
      const englishWords = entry.details.overview.map(paragraph => paragraph.en).join(' ').split(/\s+/).length;
      const chineseCharacters = entry.details.overview.map(paragraph => paragraph.zh).join('').replace(/\s/g, '').length;
      expect(englishWords, `${entry.slug} independent English overview`).toBeGreaterThanOrEqual(200);
      expect(englishWords, `${entry.slug} independent English overview`).toBeLessThanOrEqual(500);
      expect(chineseCharacters, `${entry.slug} independent Chinese overview`).toBeGreaterThanOrEqual(200);
    }
    const introductions = [...useCases, ...collections].map(entry => entry.details.overview[0].en);
    expect(new Set(introductions).size).toBe(introductions.length);
  });

  it('combines multi-value type and use-case membership with the existing source filters', () => {
    const row = { search: '中文 MCP planning Skills', category: 'repo', region: 'cn', trust: 'medium', kind: 'skill mcp', usecase: 'planning coding mcp', recommended: 'yes' };
    const filters = readDirectoryFilters(new URLSearchParams('q=ＭＣＰ&kind=mcp&usecase=planning&category=repo&recommended=yes&sort=newest'));
    expect(matchesDirectoryRow(row, filters)).toBe(true);
    expect(matchesDirectoryRow(row, { ...filters, usecase: 'plan' })).toBe(false);
    expect(matchesDirectoryRow(row, { ...filters, kind: 'skill' })).toBe(true);
    expect(matchesDirectoryRow(row, { ...filters, trust: 'high' })).toBe(false);
    expect(matchesDirectoryRow({ ...row, recommended: 'no' }, filters)).toBe(false);
    const url = writeDirectoryFilters(new URL('https://skillflux.cn/directory/?utm_source=collection#results'), filters);
    expect(readDirectoryFilters(url.searchParams)).toEqual(filters);
    expect(url.hash).toBe('#results');
    expect(url.searchParams.get('utm_source')).toBe('collection');
    expect(writeDirectoryFilters(url, readDirectoryFilters(new URLSearchParams())).search).toBe('?utm_source=collection');
    expect(readDirectoryFilters(new URLSearchParams('sort=invalid')).sort).toBe('recommended');
  });
});
