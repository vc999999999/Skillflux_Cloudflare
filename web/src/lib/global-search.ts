export type SearchLanguage = 'zh' | 'en';
export type SearchKind = 'source' | 'guide' | 'skill' | 'page';
export interface GlobalSearchEntry {
  id: string;
  lang: SearchLanguage;
  kind: SearchKind;
  title: string;
  description: string;
  href: string;
  keywords: string;
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();

/** Shared by the browser and tests; this module has no build-time data imports. */
export function searchGlobalIndex(entries: GlobalSearchEntry[], query: string, lang: SearchLanguage, limit = 12): GlobalSearchEntry[] {
  const needle = normalize(query.slice(0, 200));
  const terms = needle.split(/\s+/).filter(Boolean);
  return entries.filter(entry => entry.lang === lang).map((entry, position) => {
    const title = normalize(entry.title);
    const description = normalize(entry.description);
    const keywords = normalize(entry.keywords);
    const searchable = `${title} ${description} ${keywords}`;
    if (!terms.every(term => searchable.includes(term))) return { entry, position, score: -1 };
    const score = !needle ? 0 : (title === needle ? 100 : title.startsWith(needle) ? 60 : title.includes(needle) ? 40 : 0)
      + terms.reduce((sum, term) => sum + (title.includes(term) ? 12 : keywords.includes(term) ? 4 : 1), 0);
    return { entry, position, score };
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, Math.max(0, Math.min(limit, 50))).map(item => item.entry);
}

/** Only internal links are accepted from the static index. */
export function isGlobalSearchEntry(value: unknown): value is GlobalSearchEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'title', 'description', 'keywords', 'href'].every(key => typeof item[key] === 'string')
    && (item.lang === 'zh' || item.lang === 'en')
    && ['source', 'guide', 'skill', 'page'].includes(String(item.kind))
    && /^\/(?!\/)/.test(String(item.href)) && !/[\\\u0000-\u001f]/.test(String(item.href));
}
