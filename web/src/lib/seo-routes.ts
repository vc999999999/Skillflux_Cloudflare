import sites from '../../data/sites.json';
import categories from '../../data/categories.json';
import { getResourceEditorial } from './resource-editorial';

/** Legacy identifiers remain data keys; only their public URLs change. */
export function getLegacyRedirects(): Record<string, string> {
  const redirects: Record<string, string> = {};
  for (const prefix of ['', '/en']) {
    for (const site of sites) {
      const slug = getResourceEditorial(site.slug)?.resourceSlug ?? site.slug;
      redirects[`${prefix}/site/${site.slug}/`] = `${prefix}/resource/${slug}/`;
    }
    for (const category of categories) {
      redirects[`${prefix}/category/${category.slug}/`] = `${prefix}/source-type/${category.slug}/`;
    }
    redirects[`${prefix}/setup/`] = `${prefix}/install/`;
  }
  redirects['/sitemap-index.xml'] = '/sitemap.xml';
  redirects['/sitemap-0.xml'] = '/sitemap.xml';
  return redirects;
}

export function getRedirectTarget(pathname: string, redirects: Record<string, string>): string | undefined {
  return redirects[pathname] ?? redirects[`${pathname.replace(/\/$/, '')}/`];
}

export { isFacetedUrl } from './indexing-policy';
