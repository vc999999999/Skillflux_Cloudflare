import { describe, expect, it } from 'vitest';
import { readDirectoryFilters, writeDirectoryFilters, matchesDirectoryRow } from '../src/lib/directory-search';
import { discoveryIndex, renderDiscoveryText } from '../src/lib/discovery';
import { getSites } from '../src/lib/content';
import { getAlternateLanguagePath, getSiteCopy } from '../src/lib/i18n';
import { scenarios } from '../src/lib/scenarios';


describe('public discovery and URL state', () => {
  it('roundtrips source keyword all, combines facets and keeps meaningful URLs', () => {
    const filters = readDirectoryFilters(new URLSearchParams('q=all&category=vendors&region=cn&trust=high'));
    const target = writeDirectoryFilters(new URL('https://skillflux.app/directory/?utm=source'), filters);
    expect(readDirectoryFilters(target.searchParams)).toEqual(filters);
    expect(target.searchParams.get('q')).toBe('all');
    const row = { search: 'ALL project Skills', category: 'vendors', region: 'cn', trust: 'high' };
    expect(matchesDirectoryRow(row, filters)).toBe(true);
    expect(matchesDirectoryRow(row, { ...filters, q: 'all skills' })).toBe(true);
    expect(matchesDirectoryRow(row, { ...filters, region: 'global' })).toBe(false);
    expect(writeDirectoryFilters(target, readDirectoryFilters(new URLSearchParams())).search).toBe('?utm=source');
  });
  it('exposes scenario discovery and honest reading boundaries without changing original URLs', () => {
    const index = discoveryIndex();
    expect(index.scenarios).toHaveLength(scenarios.length);
    for (const scenario of index.scenarios) {
      expect(scenario.chineseUrl).toContain('/zh/');
    }
    const text = renderDiscoveryText(true);
    expect(text).toContain('not test results');
    for (const scenario of scenarios) { expect(text).toContain(scenario.title.en); expect(getAlternateLanguagePath(`/scenarios/${scenario.slug}/`, 'zh')).toBe(`/zh/scenarios/${scenario.slug}/`); }
  });
  it('avoids unsupported English superlative QA claims', () => {
    for (const site of getSites()) { const text = JSON.stringify(getSiteCopy(site, 'en')); expect(text).not.toContain('most complete'); expect(text).toContain('not evidence'); }
  });
});
