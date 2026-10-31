import { describe, expect, it } from 'vitest';
import { isFacetedUrl } from '../src/lib/indexing-policy';
import { getGoneRoutes, getLegacyRedirects, getRedirectTarget } from '../src/lib/seo-routes';
import { isGone } from '../src/lib/route-rules';
import { getIndexableSites, getSites, getTagIndex, buildIndexPayload } from '../src/lib/content';
import { isResourceIndexable } from '../src/lib/resource-editorial';

describe('resource and URL indexing policy', () => {
  it('excludes query variants, including blank filters, without excluding tracking or real pagination', () => {
    for (const path of ['/directory/?q=', '/en/directory/?agent=claude&type=mcp', '/directory/?sort=newest']) {
      expect(isFacetedUrl(new URL(path, 'https://skillflux.app'))).toBe(true);
    }
    for (const path of ['/directory/?utm_source=docs', '/en/directory/', '/resource/anthropic-skills/?q=note']) {
      expect(isFacetedUrl(new URL(path, 'https://skillflux.app'))).toBe(false);
    }
  });
  it('keeps permanent mappings complete, local and specific to known legacy resources', () => {
    const redirects = getLegacyRedirects();
    // Old unprefixed URLs served Chinese; old /en/ URLs served English, which is now the root.
    expect(redirects['/site/github-com-anthropics-skills/']).toBe('/zh/resource/anthropic-skills/');
    for (const site of getSites()) {
      // Only sources listed before the language flip ever had /site/ URLs.
      const legacy = site.addedAt < '2026-10-29';
      expect(getRedirectTarget(`/en/site/${site.slug}`, redirects)).toBe(legacy ? `/resource/${site.resourceSlug}/` : undefined);
      expect(getRedirectTarget(`/site/${site.slug}`, redirects)).toBe(legacy ? `/zh/resource/${site.resourceSlug}/` : undefined);
    }
    expect(getRedirectTarget('/site/nonexistent/', redirects)).toBeUndefined();
    for (const [from, to] of Object.entries(redirects)) {
      expect(to).toMatch(/^\/(?!\/)/);
      expect(to).not.toEqual(from);
      expect(redirects[to]).toBeUndefined();
      expect(isGone(to, getGoneRoutes()), `${from} redirects into a retired URL`).toBe(false);
    }
  });
  it('retires every legacy tool skill page and its versions', () => {
    const gone = getGoneRoutes();
    for (const path of ['/install/', '/setup/', '/releases/feed.xml', '/skills-index.json', '/registry/page/2/', '/skills/tdd/', '/skills/tdd/versions/1.0.0/', '/skills/answer-me-with-html/']) {
      expect(isGone(path, gone), path).toBe(true);
    }
    for (const path of ['/', '/directory/', '/skills/', '/registry/', '/scenarios/choose-a-source/']) expect(isGone(path, gone), path).toBe(false);
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
