export const facetKeys = ['q', 'search', 'category', 'region', 'trust', 'kind', 'type', 'usecase', 'use-case', 'agent', 'host', 'recommended', 'sort', 'ownership', 'open-source', 'maintenance', 'offset'] as const;

export function isFacetedUrl(url: URL): boolean {
  return /^\/(?:en\/)?(?:directory|registry(?:\/page\/\d+)?)\/?$/.test(url.pathname)
    && facetKeys.some(key => url.searchParams.has(key));
}

