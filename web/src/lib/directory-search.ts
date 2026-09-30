export interface DirectoryFilters {
  q: string;
  category: string;
  region: string;
  trust: string;
  kind: string;
  usecase: string;
  recommended: string;
  sort: 'recommended' | 'name' | 'newest';
}
export const directoryFacets = ['category', 'region', 'trust', 'kind', 'usecase', 'recommended'] as const;
export function readDirectoryFilters(params: URLSearchParams): DirectoryFilters {
  const sort = params.get('sort');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    category: params.get('category') ?? 'all',
    region: params.get('region') ?? 'all',
    trust: params.get('trust') ?? 'all',
    kind: params.get('kind') ?? 'all',
    usecase: params.get('usecase') ?? 'all',
    recommended: params.get('recommended') === 'yes' ? 'yes' : 'all',
    sort: sort === 'name' || sort === 'newest' ? sort : 'recommended',
  };
}
export function writeDirectoryFilters(url: URL, filters: DirectoryFilters): URL {
  const result = new URL(url);
  for (const key of ['q', ...directoryFacets] as const) {
    result.searchParams.delete(key);
    if (filters[key] && (key === 'q' || filters[key] !== 'all')) result.searchParams.set(key, filters[key]);
  }
  result.searchParams.delete('sort');
  if (filters.sort !== 'recommended') result.searchParams.set('sort', filters.sort);
  return result;
}
export type DirectoryRow = {
  search: string; category: string; region: string; trust: string;
  kind?: string; usecase?: string; recommended?: string;
};
export function matchesDirectoryRow(row: DirectoryRow, filters: DirectoryFilters): boolean {
  const normalized = row.search.normalize('NFKC').toLocaleLowerCase();
  const terms = filters.q.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.every(term => normalized.includes(term)) && directoryFacets.every(facet => {
    if (filters[facet] === 'all') return true;
    if (facet === 'kind' || facet === 'usecase') return (row[facet] ?? '').split(' ').includes(filters[facet]);
    return row[facet] === filters[facet];
  });
}
