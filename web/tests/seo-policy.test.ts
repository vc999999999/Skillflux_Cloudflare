import { describe, expect, it } from 'vitest';
import { isFacetedUrl } from '../src/lib/indexing-policy';
import { getLegacyRedirects, getRedirectTarget } from '../src/lib/seo-routes';
import { getIndexableSites, getSites, getTagIndex, buildIndexPayload } from '../src/lib/content';
import { isResourceIndexable } from '../src/lib/resource-editorial';

describe('resource and URL indexing policy', () => {
  it('excludes query variants, including blank filters, without excluding tracking or real pagination', () => {
    for (const path of ['/directory/?q=', '/en/directory/?agent=claude&type=mcp', '/en/registry/page/2/?q=review', '/registry/?sort=newest&page=2']) {
      expect(isFacetedUrl(new URL(path, 'https://skillflux.app'))).toBe(true);
    }
    for (const path of ['/directory/?utm_source=docs', '/en/registry/page/2/', '/registry/?page=2', '/resource/anthropic-skills/?q=note']) {
      expect(isFacetedUrl(new URL(path, 'https://skillflux.app'))).toBe(false);
    }
  });
  it('keeps permanent mappings complete, local and specific to known legacy resources', () => {
    const redirects = getLegacyRedirects();
    expect(redirects['/site/github-com-anthropics-skills/']).toBe('/resource/anthropic-skills/');
    for (const site of getSites()) {
      expect(getRedirectTarget(`/en/site/${site.slug}`, redirects)).toBe(`/en/resource/${site.resourceSlug}/`);
    }
    expect(getRedirectTarget('/site/nonexistent/', redirects)).toBeUndefined();
    for (const [from, to] of Object.entries(redirects)) {
      expect(to).toMatch(/^\/(?!\/)/);
      expect(to).not.toEqual(from);
      expect(redirects[to]).toBeUndefined();
    }
  });
  it('shares indexable data while keeping incomplete and archived resources out of the quality gate', () => {
    const site = getSites()[0];
    expect(isResourceIndexable({ ...site, name: '' })).toBe(false);
    expect(isResourceIndexable({ ...site, canonicalUrl: '' })).toBe(false);
    expect(isResourceIndexable({ ...site, status: 'archived' })).toBe(false);
    expect(isResourceIndexable({ ...site, slug: 'missing-editorial' })).toBe(false);
    expect(buildIndexPayload().sites.map(item => item.slug)).toEqual(getIndexableSites().map(item => item.slug));
  });
  it('requires unique editorial content as well as at least three resources for tags', () => {
    const tags = getTagIndex();
    for (const tag of tags.filter(tag => tag.count < 3)) expect(tag.indexable).toBe(false);
    for (const tag of tags.filter(tag => tag.indexable)) {
      expect(tag.count).toBeGreaterThanOrEqual(3);
      expect(tag.intro?.en.length).toBeGreaterThan(150);
      expect(tag.intro?.zh.length).toBeGreaterThan(50);
    }
  });
});
