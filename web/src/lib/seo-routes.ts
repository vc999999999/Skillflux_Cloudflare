import sites from '../../data/sites.json';
import categories from '../../data/categories.json';
import legacyToolUrls from '../../data/legacy-tool-urls.json';
import { getResourceEditorial } from './resource-editorial';
import type { GoneRules } from './route-rules';

/**
 * Legacy identifiers remain data keys; only their public URLs change.
 * Before the language flip Chinese lived at `/` and English at `/en/`, so an
 * old unprefixed URL maps to `/zh/` and an old `/en/` URL maps to the root.
 */
export function getLegacyRedirects(): Record<string, string> {
  const redirects: Record<string, string> = {};
  for (const [legacyPrefix, prefix] of [['', '/zh'], ['/en', '']] as const) {
    for (const site of sites) {
      const slug = getResourceEditorial(site.slug)?.resourceSlug ?? site.slug;
      redirects[`${legacyPrefix}/site/${site.slug}/`] = `${prefix}/resource/${slug}/`;
    }
    for (const category of categories) {
      redirects[`${legacyPrefix}/category/${category.slug}/`] = `${prefix}/source-type/${category.slug}/`;
    }
  }
  redirects['/registry/'] = '/directory/';
  redirects['/en/registry/'] = '/directory/';
  redirects['/sitemap-index.xml'] = '/sitemap.xml';
  redirects['/sitemap-0.xml'] = '/sitemap.xml';
  return redirects;
}

export function getRedirectTarget(pathname: string, redirects: Record<string, string>): string | undefined {
  return redirects[pathname] ?? redirects[`${pathname.replace(/\/$/, '')}/`];
}

/** URLs of the archived installer, release pipeline and tool-only guides. They answer 410. */
export function getGoneRoutes(): GoneRules {
  return {
    exact: [
      '/install/', '/setup/', '/releases/feed.xml', '/skills-index.json',
      '/scenarios/connect-a-project/', '/scenarios/maintain-project-skills/',
      ...legacyToolUrls.skillIds.map(id => `/skills/${id}/`),
    ],
    prefixes: ['/registry/page/', ...legacyToolUrls.skillIds.map(id => `/skills/${id}/versions/`)],
  };
}

export { isFacetedUrl } from './indexing-policy';
