export interface SearchableSkill {
  id: string;
  version: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  hosts: string[];
  publisher: string;
  createdAt: string;
}

export interface PublicationFilters {
  q: string;
  category: string;
  host: string;
  sort: 'relevance' | 'newest' | 'name';
  page: number;
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN');
export const PUBLICATION_PAGE_SIZE = 12;

export function registryPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PUBLICATION_PAGE_SIZE));
}

export function registryPagePath(page: number, lang: 'zh' | 'en' = 'zh'): string {
  const prefix = lang === 'en' ? '/en' : '';
  return `${prefix}/registry/${page > 1 ? `page/${page}/` : ''}`;
}

export function registryPageNumber(pathname: string): number {
  const match = pathname.match(/^\/(?:en\/)?registry\/page\/([1-9]\d*)\/$/);
  const page = Number(match?.[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function hasPublicationFilters(state: PublicationFilters): boolean {
  return Boolean(state.q || state.category || state.host || state.sort !== 'relevance');
}

export function readPublicationUrl(url: URL): PublicationFilters {
  return readPublicationFilters(url.searchParams, registryPageNumber(url.pathname));
}

/** Only real page 2+ routes are generated; the first page remains /registry/. */
export function registryExtraPages(total: number): number[] {
  return Array.from({ length: registryPageCount(total) - 1 }, (_, index) => index + 2);
}

export function compareSkillVersions(left: string, right: string): number {
  const [leftCore, leftPre] = left.split('+')[0]!.split(/-(.*)/s);
  const [rightCore, rightPre] = right.split('+')[0]!.split(/-(.*)/s);
  const a = leftCore!.split('.');
  const b = rightCore!.split('.');
  for (let index = 0; index < 3; index++) {
    const x = BigInt(a[index] ?? 0), y = BigInt(b[index] ?? 0);
    if (x !== y) return x > y ? 1 : -1;
  }
  if (leftPre === undefined || rightPre === undefined) return leftPre === rightPre ? 0 : leftPre === undefined ? 1 : -1;
  const ap = leftPre.split('.'), bp = rightPre.split('.');
  for (let index = 0; index < Math.max(ap.length, bp.length); index++) {
    const x = ap[index], y = bp[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function latestSkills<T extends SearchableSkill>(items: T[]): T[] {
  const latest = new Map<string, T>();
  for (const item of items) {
    const previous = latest.get(item.id);
    if (!previous || compareSkillVersions(item.version, previous.version) > 0) latest.set(item.id, item);
  }
  return [...latest.values()];
}

export function readPublicationFilters(params: URLSearchParams, routePage = 1): PublicationFilters {
  const sort = params.get('sort');
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').slice(0, 200), category: params.get('category') ?? '',
    host: ['generic', 'codex', 'claude', 'cursor'].includes(params.get('host') ?? '') ? params.get('host')! : '',
    sort: sort === 'newest' || sort === 'name' ? sort : 'relevance',
    page: params.has('page') ? (Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1) : routePage,
  };
}

export function writePublicationFilters(url: URL, state: PublicationFilters): URL {
  const result = new URL(url);
  for (const key of ['q', 'category', 'host', 'sort', 'page', 'offset']) result.searchParams.delete(key);
  if (state.q) result.searchParams.set('q', state.q);
  if (state.category) result.searchParams.set('category', state.category);
  if (state.host) result.searchParams.set('host', state.host);
  if (state.sort !== 'relevance') result.searchParams.set('sort', state.sort);
  const registryRoute = /^\/(?:en\/)?registry(?:\/page\/\d+)?\/?$/.test(result.pathname);
  const filtered = hasPublicationFilters(state);
  if (registryRoute) result.pathname = registryPagePath(filtered ? 1 : state.page, result.pathname.startsWith('/en/') ? 'en' : 'zh');
  if (state.page > 1 && (filtered || !registryRoute)) result.searchParams.set('page', String(state.page));
  return result;
}

function relevance(skill: SearchableSkill, query: string): number {
  const phrase = normalize(query).trim();
  if (!phrase) return 0;
  const terms = new Set(phrase.match(/[\p{L}\p{N}]+/gu) ?? []);
  for (const term of [...terms]) if (/^\p{Script=Han}+$/u.test(term) && term.length > 2) {
    for (let index = 0; index < term.length - 1; index++) terms.add(term.slice(index, index + 2));
  }
  return ([[skill.name, 10], [skill.id, 9], [skill.tags.join(' '), 7], [skill.category, 6], [skill.description, 4], [skill.publisher, 1]] as const)
    .reduce((sum, [text, weight]) => {
      const value = normalize(text);
      const bonus = value === phrase ? 5 : value.includes(phrase) ? 3 : 0;
      return sum + weight * (bonus + [...terms].filter(term => value.includes(term)).length);
    }, 0);
}

export function searchPublication<T extends SearchableSkill>(items: T[], filters: PublicationFilters): T[] {
  return items.filter(item => (!filters.category || item.category === filters.category)
    && (!filters.host || item.hosts.includes(filters.host) || item.hosts.includes('generic')))
    .map(item => ({ item, score: relevance(item, filters.q) }))
    .filter(result => !filters.q.trim() || result.score > 0)
    .sort((a, b) => {
      if (filters.sort === 'name') return a.item.name.localeCompare(b.item.name, 'zh-CN') || a.item.id.localeCompare(b.item.id);
      if (filters.sort === 'relevance' && filters.q.trim() && a.score !== b.score) return b.score - a.score;
      return b.item.createdAt.localeCompare(a.item.createdAt) || compareSkillVersions(b.item.version, a.item.version) || a.item.id.localeCompare(b.item.id);
    }).map(result => result.item);
}
