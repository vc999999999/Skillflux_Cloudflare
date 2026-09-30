import { describe, expect, it } from 'vitest';
import { isGlobalSearchEntry, searchGlobalIndex, type GlobalSearchEntry } from '../src/lib/global-search';
import { GET } from '../src/pages/search-index.json';
import { getSites } from '../src/lib/content';
import { localizePath } from '../src/lib/i18n';

const entry = (id: string, changes: Partial<GlobalSearchEntry> = {}): GlobalSearchEntry => ({ id, lang: 'zh', kind: 'source', title: id, description: 'Agent tools', keywords: '', href: `/resource/${id}/`, ...changes });

describe('global search', () => {
  it('ranks exact titles above keyword matches, normalizes full-width input, and requires all words', () => {
    const items = [entry('keyword', { keywords: 'github code' }), entry('github', { title: 'GitHub', description: 'Code hosting' }), entry('partial', { title: 'GitHub guides' })];
    expect(searchGlobalIndex(items, 'ＧＩＴＨＵＢ', 'zh').map(item => item.id)).toEqual(['github', 'partial', 'keyword']);
    expect(searchGlobalIndex(items, 'github code', 'zh').map(item => item.id)).toEqual(['github', 'keyword']);
    expect(searchGlobalIndex(items, 'missing', 'zh')).toEqual([]);
  });
  it('keeps language-specific links and includes Chinese partial phrase matches', () => {
    const items = [entry('zh', { title: '代码审查', kind: 'page', href: '/scenarios/choose-a-source/' }), entry('en', { title: 'Code review', lang: 'en', href: '/en/scenarios/choose-a-source/', keywords: '代码审查' })];
    expect(searchGlobalIndex(items, '审查', 'zh').map(item => item.href)).toEqual(['/scenarios/choose-a-source/']);
    expect(searchGlobalIndex(items, '审查', 'en').map(item => item.href)).toEqual(['/en/scenarios/choose-a-source/']);
    expect(searchGlobalIndex(items, '', 'en')).toHaveLength(1);
  });
  it('rejects noninternal links and malformed indexes before creating result anchors', () => {
    expect(isGlobalSearchEntry(entry('valid'))).toBe(true);
    for (const href of ['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test', 'javascript:alert(1)']) expect(isGlobalSearchEntry(entry('bad', { href }))).toBe(false);
    expect(isGlobalSearchEntry({ ...entry('bad'), title: 4 })).toBe(false);
    expect(isGlobalSearchEntry({ ...entry('bad'), kind: 'unknown' })).toBe(false);
  });
  it('builds a bilingual index with canonical source and editorial routes', async () => {
    const payload = await GET().json() as { entries: GlobalSearchEntry[] };
    expect(payload.entries.every(isGlobalSearchEntry)).toBe(true);
    expect(new Set(payload.entries.map(item => item.id)).size).toBe(payload.entries.length);
    for (const lang of ['zh', 'en'] as const) {
      const entries = payload.entries.filter(item => item.lang === lang);
      expect(entries.filter(item => item.kind === 'source').map(item => item.href)).toEqual(getSites().map(site => localizePath(`/resource/${site.resourceSlug}/`, lang)));
    }
  });
});
