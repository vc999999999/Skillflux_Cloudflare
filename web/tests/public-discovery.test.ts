import { describe, expect, it } from 'vitest';
import { PUBLICATION_PAGE_SIZE, compareSkillVersions, hasPublicationFilters, latestSkills, readPublicationFilters, readPublicationUrl, registryExtraPages, registryPageCount, registryPageNumber, registryPagePath, searchPublication, writePublicationFilters, type SearchableSkill } from '../src/lib/publication-search';
import { readDirectoryFilters, writeDirectoryFilters, matchesDirectoryRow } from '../src/lib/directory-search';
import { discoveryIndex, renderDiscoveryText } from '../src/lib/discovery';
import { validatePublication } from '../src/lib/publication';
import { getSites, renderRobotsTxt } from '../src/lib/content';
import { getAlternateLanguagePath, getSiteCopy } from '../src/lib/i18n';
import { scenarios } from '../src/lib/scenarios';


const skill = (id: string, changes: Partial<SearchableSkill> = {}): SearchableSkill => ({ id, version: '1.0.0', name: id, description: 'Review project files', category: 'engineering', tags: ['code'], hosts: ['codex'], publisher: 'Isolated unit fixture', createdAt: '2026-09-01T00:00:00.000Z', ...changes });
describe('public discovery and URL state', () => {
  it('selects semver latest, including numeric prerelease and arbitrary precision', () => {
    expect(compareSkillVersions('1.10.0', '1.9.99')).toBeGreaterThan(0);
    expect(compareSkillVersions('1.0.0', '1.0.0-rc.99')).toBeGreaterThan(0);
    expect(compareSkillVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBeGreaterThan(0);
    expect(compareSkillVersions('1.0.0-1', '1.0.0-a')).toBeLessThan(0);
    expect(compareSkillVersions('99999999999999999999.0.0', '99999999999999999998.0.0')).toBeGreaterThan(0);
    expect(compareSkillVersions('1.2.3+build-a', '1.2.3+build-b')).toBe(0);
    expect(latestSkills([skill('a', { version: '1.0.0' }), skill('a', { version: '1.1.0' }), skill('b')]).map(item => `${item.id}@${item.version}`)).toEqual(['a@1.1.0', 'b@1.0.0']);
  });
  it('normalizes invalid pagination, host and sorting while preserving a bounded query', () => {
    const filters = readPublicationFilters(new URLSearchParams({ q: 'x'.repeat(400), host: 'unsafe', page: '-2', sort: 'invalid' }));
    expect(filters).toEqual({ q: 'x'.repeat(200), host: '', page: 1, sort: 'relevance', category: '' });
    expect(readPublicationFilters(new URLSearchParams('page=2.5')).page).toBe(1);
    expect(readPublicationFilters(new URLSearchParams('page=99999999')).page).toBe(100000);
  });
  it('roundtrips all curated filters without discarding unrelated parameters or hash', () => {
    const filters = { q: '代码 审查', category: 'engineering', host: 'codex', sort: 'newest' as const, page: 3 };
    const target = writePublicationFilters(new URL('https://skillflux.cn/registry/?utm_source=docs&offset=10#list'), filters);
    expect(readPublicationFilters(target.searchParams)).toEqual(filters);
    expect(target.searchParams.get('utm_source')).toBe('docs');
    expect(target.searchParams.has('offset')).toBe(false);
    expect(target.hash).toBe('#list');
    const clear = writePublicationFilters(target, readPublicationFilters(new URLSearchParams()));
    expect(clear.search).toBe('?utm_source=docs');
  });
  it('maps ordinary pagination to distinct bilingual paths and generates no phantom pages', () => {
    expect(PUBLICATION_PAGE_SIZE).toBe(12);
    expect(registryExtraPages(0)).toEqual([]);
    expect(registryExtraPages(12)).toEqual([]);
    expect(registryExtraPages(13)).toEqual([2]);
    expect(registryExtraPages(25)).toEqual([2, 3]);
    expect(registryPageCount(24)).toBe(2);
    expect(registryPagePath(1)).toBe('/registry/');
    expect(registryPagePath(2, 'en')).toBe('/en/registry/page/2/');
    for (const page of [1, 2, 3]) {
      const path = registryPagePath(page, 'en');
      expect(registryPageNumber(path)).toBe(page);
      const state = readPublicationUrl(new URL(`https://skillflux.cn${path}`));
      expect(state.page).toBe(page);
      const target = writePublicationFilters(new URL('https://skillflux.cn/en/registry/?utm_source=docs#list'), state);
      expect(target.pathname).toBe(path);
      expect(target.search).toBe('?utm_source=docs');
      expect(target.hash).toBe('#list');
      expect(readPublicationUrl(target)).toEqual(state);
    }
    expect(registryPageNumber('/registry/page/0/')).toBe(1);
    expect(registryPageNumber('/registry/page/2.5/')).toBe(1);
  });
  it('keeps filtered pagination on the registry root and clears filters back to page one', () => {
    const state = readPublicationFilters(new URLSearchParams('q=review&sort=name&page=2'));
    expect(hasPublicationFilters(state)).toBe(true);
    const filtered = writePublicationFilters(new URL('https://skillflux.cn/en/registry/page/3/?utm_source=docs'), state);
    expect(filtered.pathname).toBe('/en/registry/');
    expect(filtered.searchParams.get('page')).toBe('2');
    expect(readPublicationUrl(filtered)).toEqual(state);
    const cleared = writePublicationFilters(filtered, readPublicationFilters(new URLSearchParams()));
    expect(cleared.pathname).toBe('/en/registry/');
    expect(cleared.search).toBe('?utm_source=docs');
    expect(hasPublicationFilters(readPublicationUrl(cleared))).toBe(false);
    expect(readPublicationUrl(new URL('https://skillflux.cn/registry/page/3/?page=2')).page).toBe(2);
  });
  it('has identical deterministic server and client page membership without losing or duplicating skills', () => {
    const items = Array.from({ length: 25 }, (_, index) => skill(`skill-${String(index).padStart(2, '0')}`));
    const ordered = searchPublication(items.reverse(), readPublicationFilters(new URLSearchParams()));
    const rendered = [1, ...registryExtraPages(items.length)].map(page => {
      const state = readPublicationUrl(new URL(`https://skillflux.cn${registryPagePath(page)}`));
      return searchPublication(items, state).slice((page - 1) * PUBLICATION_PAGE_SIZE, page * PUBLICATION_PAGE_SIZE);
    });
    expect(rendered.map(page => page.length)).toEqual([12, 12, 1]);
    expect(rendered.flat().map(item => item.id)).toEqual(ordered.map(item => item.id));
    expect(new Set(rendered.flat().map(item => item.id)).size).toBe(25);
  });
  it('ranks exact names ahead of publisher-only matches and includes generic hosts', () => {
    const entries = [skill('publisher-hit', { publisher: 'review' }), skill('exact', { name: 'Review', hosts: ['generic'] }), skill('wrong-host', { name: 'Review', hosts: ['cursor'] })];
    const filters = readPublicationFilters(new URLSearchParams('q=review&host=codex'));
    expect(searchPublication(entries, filters).map(item => item.id)).toEqual(['exact', 'publisher-hit']);
    expect(searchPublication(entries, { ...filters, category: 'other' })).toEqual([]);
  });
  it('supports Chinese capability phrases, empty results and deterministic sort', () => {
    const entries = [skill('a', { name: '代码审查', createdAt: '2026-09-02T00:00:00Z' }), skill('b', { name: '内容写作' })];
    expect(searchPublication(entries, readPublicationFilters(new URLSearchParams('q=审查')))[0]?.id).toBe('a');
    expect(searchPublication(entries, readPublicationFilters(new URLSearchParams('q=没有此能力')))).toEqual([]);
    expect(searchPublication(entries, readPublicationFilters(new URLSearchParams('sort=newest'))).map(item => item.id)).toEqual(['a', 'b']);
  });
  it('roundtrips source keyword all, combines facets and keeps meaningful URLs', () => {
    const filters = readDirectoryFilters(new URLSearchParams('q=all&category=vendors&region=cn&trust=high'));
    const target = writeDirectoryFilters(new URL('https://skillflux.cn/directory/?utm=source'), filters);
    expect(readDirectoryFilters(target.searchParams)).toEqual(filters);
    expect(target.searchParams.get('q')).toBe('all');
    const row = { search: 'ALL project Skills', category: 'vendors', region: 'cn', trust: 'high' };
    expect(matchesDirectoryRow(row, filters)).toBe(true);
    expect(matchesDirectoryRow(row, { ...filters, q: 'all skills' })).toBe(true);
    expect(matchesDirectoryRow(row, { ...filters, region: 'global' })).toBe(false);
    expect(writeDirectoryFilters(target, readDirectoryFilters(new URLSearchParams())).search).toBe('?utm=source');
  });
  it('exposes honest empty publication and complete scenario discovery without changing original URLs', () => {
    const publication = validatePublication({ schema: 'skillflux-publication/v2', repo: null, commitSha: null, fetchedAt: null, items: [] });
    const index = discoveryIndex(publication);
    expect(index.curated.skills).toEqual([]);
    expect(index.scenarios).toHaveLength(3);
    for (const scenario of index.scenarios) {
      expect(scenario.englishUrl).toContain('/en/');
    }
    const text = renderDiscoveryText(true, publication);
    expect(text).toContain('No qualified releases');
    expect(text).toContain('Catalog repository: Not configured');
    for (const scenario of scenarios) { expect(text).toContain(scenario.title.zh); expect(getAlternateLanguagePath(`/scenarios/${scenario.slug}/`, 'en')).toBe(`/en/scenarios/${scenario.slug}/`); }
    expect(getAlternateLanguagePath('/skills/demo/versions/1.0.0/', 'en')).toBe('/en/skills/demo/versions/1.0.0/');
  });
  it('keeps console outside crawling and avoids unsupported English superlative QA claims', () => {
    expect(renderRobotsTxt()).toContain('Disallow: /console/');
    expect(renderRobotsTxt()).toContain('Disallow: /en/console/');
    for (const site of getSites()) { const text = JSON.stringify(getSiteCopy(site, 'en')); expect(text).not.toContain('most complete'); expect(text).toContain('not evidence'); }
  });
});
