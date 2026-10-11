import { decodeXML } from 'entities';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { absoluteUrl, getIndexableSites, type Site } from '../src/lib/content';
import { canonical, sha256, type Manifest, type ReleaseMetadata } from '../../mcp/src/shared';
import { validatePublication, type PublicationSnapshot, type PublishedManifest, type PublishedSkill } from '../src/lib/publication';
import { renderInsightsFeed, renderReleasesFeed, renderUpdatesFeed } from '../src/lib/rss';

type Insight = Parameters<typeof renderUpdatesFeed>[0][number];

function insight(id = 'published-article', overrides: Partial<Insight['data']> = {}): Insight {
  return {
    id,
    body: 'An authored explanation with a concrete workflow and its limitations.',
    data: {
      title: `Skill workflow analysis: ${id}`,
      description: 'A practical explanation of this skill workflow and the boundaries of its use.',
      datePublished: '2026-10-01',
      dateModified: '2026-10-10',
      industry: 'Engineering',
      skillName: 'Example skill',
      source: { repo: 'https://github.com/example/skill', author: 'Example author', license: 'MIT' },
      tags: ['engineering'],
      relatedSites: [],
      tldr: 'This skill separates requirements, implementation and verification into explicit steps.',
      scenarios: ['Clarifying requirements', 'Reviewing implementation'],
      workflow: [
        { step: 'Clarify', detail: 'Establish the expected behavior before changing code.' },
        { step: 'Implement', detail: 'Implement the smallest complete user-facing behavior.' },
        { step: 'Verify', detail: 'Check the resulting behavior against the requirements.' }
      ],
      judgments: [
        'Check behavior instead of copying the implementation into tests.',
        'Clarify missing requirements before committing to an architecture.',
        'Keep each change independently reviewable and verifiable.'
      ],
      painPoints: [
        { pain: 'Unclear requirements', solution: 'Record the expected behavior explicitly.' },
        { pain: 'Unverified implementation', solution: 'Check behavior with a reproducible example.' }
      ],
      limitations: ['Requires access to relevant project context.', 'Does not guarantee a correct implementation.'],
      draft: false,
      ...overrides
    }
  };
}

function resource(): Site {
  const site = getIndexableSites().find(entry => entry.editorial?.capabilityBreakdown?.length);
  if (!site) throw new Error('The RSS regression fixture requires a resource with capability details.');
  return { ...structuredClone(site), updatedAt: '2026-10-10' };
}

function publishedSkill(options: { version?: string; createdAt?: string; release?: Partial<ReleaseMetadata> | null; body?: string } = {}): PublishedSkill {
  const createdAt = options.createdAt ?? '2026-10-09T08:00:00.000Z';
  const files = { 'SKILL.md': options.body ?? '# Synthetic release\nA fixture for RSS delivery, not a real Skill.' };
  const manifest: Manifest = {
    schema: 'skillflux/v1', id: 'synthetic-skill', version: options.version ?? '1.0.0',
    name: 'Synthetic Skill', description: 'Synthetic package release for RSS regression testing.',
    category: 'development', tags: ['test'], hosts: ['generic'], publisher: 'RSS tests', license: 'MIT',
    entry: 'SKILL.md', permissions: { network: [], shell: false, secrets: [] }, dependencies: [], createdAt,
    ...(options.release === null ? {} : { release: {
      notes: 'Explain the newly supported workflow.', breaking: false, minClientVersion: '1.1.0',
      maintainedAt: '2026-10-11T09:30:00+08:00', maintainedBy: 'RSS tests', ...options.release
    } })
  };
  const fileRecords = Object.entries(files).map(([path, content]) => ({ path, sha256: sha256(content), size: Buffer.byteLength(content) }));
  const digest = sha256(canonical({ manifest, files }));
  const publishedManifest: PublishedManifest = { ...manifest, files: fileRecords };
  return {
    skill: {
      ...manifest, digest, size: fileRecords.reduce((sum, file) => sum + file.size, 0), status: 'approved', qualification: 'qualified',
      quality: {
        automated: { passed: true, checks: ['synthetic fixture'], checkedAt: createdAt },
        review: { reviewer: 'RSS tests', reviewedAt: createdAt, notes: 'Synthetic review' },
        evaluation: {
          evaluationId: 'rss-fixture', contentHash: digest, testedAt: createdAt,
          summary: 'Synthetic test evidence only.', hosts: ['generic'], purposePassed: true, boundaryPassed: true
        }
      }
    },
    bundle: { manifest: publishedManifest, files }
  };
}

function publication(entries: PublishedSkill[], overrides: Partial<PublicationSnapshot> = {}) {
  return validatePublication({
    schema: 'skillflux-publication/v2', repo: 'fixture-owner/catalog', commitSha: 'a'.repeat(40),
    fetchedAt: '2026-10-11T10:00:00.000Z', items: entries, ...overrides
  });
}

function element(xml: string, name: string): string {
  const value = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1];
  if (value === undefined) throw new Error(`Missing RSS element: ${name}`);
  return decodeXML(value);
}

function items(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => ({
    title: element(match[1]!, 'title'),
    link: element(match[1]!, 'link'),
    guid: element(match[1]!, 'guid'),
    description: element(match[1]!, 'description'),
    pubDate: element(match[1]!, 'pubDate')
  }));
}

afterEach(() => vi.useRealTimers());

describe('RSS content update delivery', () => {
  it('includes published articles alongside resources, while excluding drafts and non-indexable resources', () => {
    const published = insight();
    const draft = insight('unpublished-draft', { draft: true, dateModified: '2026-10-11' });
    const visible = resource();
    const hidden = { ...resource(), resourceSlug: 'hidden-resource', indexable: false };

    const main = items(renderUpdatesFeed([draft, published], [hidden, visible]));
    expect(main.map(item => item.link).sort()).toEqual([
      absoluteUrl(`/insights/${published.id}/`),
      absoluteUrl(`/resource/${visible.resourceSlug}/`)
    ].sort());
    expect(items(renderInsightsFeed([draft, published])).map(item => item.link)).toEqual([
      absoluteUrl(`/insights/${published.id}/`)
    ]);
  });

  it('uses the same article revision identity in both subscriptions', () => {
    const article = insight();
    const main = renderUpdatesFeed([article], []);
    const focused = renderInsightsFeed([article]);
    expect(items(main)[0]!.guid).toBe(items(focused)[0]!.guid);
    expect(main).toContain('<guid isPermaLink="false">');
    expect(focused).toContain('<guid isPermaLink="false">');
    expect(items(main)[0]!.link).toBe(absoluteUrl(`/insights/${article.id}/`));
  });

  it.each(['article body', 'resource capability'] as const)('delivers exactly one new item to an existing reader after a same-day edit to %s', (change) => {
    const article = insight();
    const site = resource();
    const before = items(renderUpdatesFeed([article], [site]));
    const readGuids = new Set(before.map(item => item.guid));
    let changedUrl: string;

    if (change === 'article body') {
      article.body = `${article.body ?? ''}\nA new example explains an additional failure case.`;
      changedUrl = absoluteUrl(`/insights/${article.id}/`);
    } else {
      const capability = site.editorial?.capabilityBreakdown?.[0];
      if (!capability) throw new Error('Missing capability fixture.');
      capability.description.zh += ' 新增一个明确的适用场景。';
      changedUrl = absoluteUrl(`/resource/${site.resourceSlug}/`);
    }

    const after = items(renderUpdatesFeed([article], [site]));
    const unread = after.filter(item => !readGuids.has(item.guid));
    expect(unread).toHaveLength(1);
    expect(unread[0]!.link).toBe(changedUrl);
    expect(after.map(item => item.pubDate)).toEqual(before.map(item => item.pubDate));
    expect(items(renderUpdatesFeed([article], [site])).map(item => item.guid)).toEqual(after.map(item => item.guid));
  });

  it('does not produce new content or timestamps just because the site is rebuilt later', () => {
    const article = insight();
    const site = resource();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T08:00:00Z'));
    const initialMain = renderUpdatesFeed([article], [site]);
    const initialFocused = renderInsightsFeed([article]);
    vi.setSystemTime(new Date('2027-02-15T23:00:00Z'));
    expect(renderUpdatesFeed([article], [site])).toBe(initialMain);
    expect(renderInsightsFeed([article])).toBe(initialFocused);
    expect(element(initialMain, 'lastBuildDate')).toBe('Sat, 10 Oct 2026 00:00:00 GMT');
  });

  it('keeps revision identities stable when authored objects are reordered without changing values', () => {
    const original = insight();
    const { title, source, ...otherData } = original.data;
    const reordered: Insight = {
      body: original.body,
      data: {
        ...otherData,
        source: { license: source.license, author: source.author, repo: source.repo },
        title
      },
      id: original.id
    };
    const site = resource();
    const { name, editorial, ...otherSite } = site;
    const reorderedSite: Site = { ...otherSite, editorial, name };
    expect(renderUpdatesFeed([reordered], [reorderedSite])).toBe(renderUpdatesFeed([original], [site]));
  });

  it('announces authored date changes and orders articles by their modification date', () => {
    const revised = insight('older-revised', { datePublished: '2026-09-01', dateModified: '2026-10-10' });
    const newer = insight('newer-publication', { datePublished: '2026-10-09', dateModified: '2026-10-09' });
    const initialGuid = items(renderInsightsFeed([revised]))[0]!.guid;
    revised.data.dateModified = '2026-10-11';

    for (const xml of [renderUpdatesFeed([newer, revised], []), renderInsightsFeed([newer, revised])]) {
      const entries = items(xml);
      expect(entries[0]!.link).toBe(absoluteUrl(`/insights/${revised.id}/`));
      expect(entries[0]!.guid).not.toBe(initialGuid);
      expect(entries[0]!.pubDate).toBe('Sun, 11 Oct 2026 00:00:00 GMT');
      expect(element(xml, 'lastBuildDate')).toBe(entries[0]!.pubDate);
    }
  });

  it('keeps a deterministic 30-item window and retains the newest revision among older articles', () => {
    const articles = Array.from({ length: 35 }, (_, index) => insight(`article-${String(index).padStart(2, '0')}`));
    articles[34]!.data.dateModified = '2026-10-11';
    const xml = renderUpdatesFeed(articles, []);
    expect(renderUpdatesFeed([...articles].reverse(), [])).toBe(xml);
    expect(items(xml)).toHaveLength(30);
    expect(items(xml)[0]!.link).toBe(absoluteUrl('/insights/article-34/'));
    expect(new Set(items(xml).map(item => item.guid)).size).toBe(30);
    expect(items(renderInsightsFeed(articles))).toHaveLength(30);
  });

  it('escapes XML text while preserving readable titles, summaries and source links', () => {
    const article = insight('xml-text', {
      title: 'A & B <workflow> "quoted" \'example\'',
      tldr: 'Keep <script> and A & B as text, including "quotes" and \'apostrophes\'.',
      source: { repo: 'https://example.com/skill?a=1&b=2', author: 'A & B', license: 'MIT' }
    });
    const xml = renderInsightsFeed([article]);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;workflow&gt;');
    expect(xml).toContain('&quot;quoted&quot;');
    expect(xml).toContain('&apos;example&apos;');
    expect(xml).not.toContain('<script>');
    expect(items(xml)[0]!.title).toBe(article.data.title);
    expect(items(xml)[0]!.description).toBe(`${article.data.tldr} 来源: ${article.data.source.repo}`);
  });

  it.each(['not-a-date', '2026-02-30', '2025-02-29', '2026-13-01', '2026-10-11T12:00:00Z'])('rejects invalid authored date %s instead of publishing an invalid or normalized date', (date) => {
    expect(() => renderInsightsFeed([insight('invalid-date', { dateModified: date })])).toThrow('Invalid RSS content date');
    const site = resource();
    site.updatedAt = date;
    expect(() => renderUpdatesFeed([], [site])).toThrow('Invalid RSS content date');
  });

  it('accepts a real leap day', () => {
    const xml = renderInsightsFeed([insight('leap-day', { dateModified: '2028-02-29' })]);
    expect(items(xml)[0]!.pubDate).toBe('Tue, 29 Feb 2028 00:00:00 GMT');
  });

  it('renders discoverable empty feeds without inventing an update time', () => {
    for (const [xml, path] of [
      [renderUpdatesFeed([], []), '/feed.xml'],
      [renderInsightsFeed([]), '/insights/feed.xml']
    ] as const) {
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
      expect(xml).toContain(`<atom:link href="${absoluteUrl(path)}" rel="self" type="application/rss+xml" />`);
      expect(element(xml, 'title')).not.toBe('');
      expect(element(xml, 'description')).not.toBe('');
      expect(xml).not.toContain('<lastBuildDate>');
      expect(xml).not.toContain('Invalid Date');
      expect(items(xml)).toEqual([]);
      expect(xml).toContain('</channel>\n</rss>');
    }
  });
});

describe('RSS qualified Skill version delivery', () => {
  it('announces the same package identity in the main and release-only feeds with actionable release details', () => {
    const catalog = publication([publishedSkill({ release: {
      notes: 'Adds <structured> output & removes the old field.', breaking: true, minClientVersion: '1.2.0'
    } })]);
    const main = items(renderUpdatesFeed([insight()], [resource()], catalog));
    const xml = renderReleasesFeed(catalog);
    const focused = items(xml);
    expect(main).toHaveLength(3);
    expect(focused).toHaveLength(1);
    expect(main.find(item => item.guid === focused[0]!.guid)).toEqual(focused[0]);
    expect(focused[0]!.guid).toBe('urn:skillflux:release:fixture-owner/catalog:synthetic-skill:1.0.0');
    expect(focused[0]!.title).toContain('v1.0.0');
    expect(focused[0]!.link).toBe(absoluteUrl('/skills/synthetic-skill/versions/1.0.0/'));
    expect(focused[0]!.description).toContain('Adds <structured> output & removes the old field.');
    expect(focused[0]!.description).toContain('破坏性变更：有');
    expect(focused[0]!.description).toContain('最低客户端版本：1.2.0');
    expect(focused[0]!.description).toContain('skillflux.check_updates');
    expect(focused[0]!.pubDate).toBe('Sun, 11 Oct 2026 01:30:00 GMT');
    expect(xml).toContain('Adds &lt;structured&gt; output &amp; removes the old field.');
    expect(xml).toContain(`<atom:link href="${absoluteUrl('/releases/feed.xml')}" rel="self" type="application/rss+xml" />`);
    expect(element(xml, 'link')).toBe(absoluteUrl('/registry/'));
  });

  it('retains multiple versions and delivers exactly one new release after a catalog update', () => {
    const old = publishedSkill({ release: { maintainedAt: '2026-10-10T12:00:00Z' } });
    const first = items(renderReleasesFeed(publication([old])));
    const next = publishedSkill({ version: '1.1.0', release: { maintainedAt: '2026-10-11T09:30:00+08:00' } });
    const catalog = publication([old, next]);
    const second = items(renderReleasesFeed(catalog));
    const read = new Set(first.map(item => item.guid));
    expect(second).toHaveLength(2);
    expect(second.filter(item => !read.has(item.guid)).map(item => item.title)).toEqual(['Synthetic Skill · v1.1.0']);
    expect(second[0]!.link).toBe(absoluteUrl('/skills/synthetic-skill/versions/1.1.0/'));
    expect(renderReleasesFeed(publication([next, old]))).toBe(renderReleasesFeed(catalog));
  });

  it('keeps package GUIDs stable across rebuild times, commit changes and descriptive metadata changes', () => {
    const original = publishedSkill();
    const changed = publishedSkill({ release: { notes: 'An editorial clarification.' }, body: '# Changed fixture body' });
    const before = publication([original]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const rebuilt = publication([original], { commitSha: 'b'.repeat(40), fetchedAt: '2030-01-01T00:00:00Z' });
    expect(renderReleasesFeed(rebuilt)).toBe(renderReleasesFeed(before));
    const guid = items(renderReleasesFeed(before))[0]!.guid;
    expect(items(renderReleasesFeed(publication([changed])))[0]!.guid).toBe(guid);
    expect(items(renderReleasesFeed(publication([original], { repo: 'Fixture-Owner/Catalog' })))[0]!.guid).toBe(guid);
    expect(items(renderReleasesFeed(publication([original], { repo: 'another-owner/catalog' })))[0]!.guid).not.toBe(guid);
  });

  it('uses authored date-only or timestamp values, sorts by actual instants and falls back to creation time for legacy releases', () => {
    const catalog = publication([
      publishedSkill({ version: '1.0.0', release: null, createdAt: '2026-10-11' }),
      publishedSkill({ version: '1.1.0', release: { maintainedAt: '2026-10-11T02:00:00Z' } }),
      publishedSkill({ version: '1.2.0', release: { maintainedAt: '2026-10-11T09:30:00+08:00' } })
    ]);
    const result = items(renderReleasesFeed(catalog));
    expect(result.map(item => item.title)).toEqual([
      'Synthetic Skill · v1.1.0', 'Synthetic Skill · v1.2.0', 'Synthetic Skill · v1.0.0'
    ]);
    expect(result[2]!.pubDate).toBe('Sun, 11 Oct 2026 00:00:00 GMT');
    expect(result[2]!.description).toContain('此版本未提供单独更新说明');
    expect(element(renderReleasesFeed(catalog), 'lastBuildDate')).toBe(result[0]!.pubDate);
    const combined = items(renderUpdatesFeed([insight('same-day', { dateModified: '2026-10-11' })], [], catalog));
    expect(combined[0]!.guid).toBe(result[0]!.guid);
    const dateOnlyRelease = items(renderReleasesFeed(publication([publishedSkill({ release: { maintainedAt: '2026-10-11' } })])));
    expect(dateOnlyRelease[0]!.pubDate).toBe('Sun, 11 Oct 2026 00:00:00 GMT');
  });

  it('excludes needs-testing and revoked status entries, and refuses unqualified or tampered public content at the existing validation boundary', () => {
    const qualified = publishedSkill();
    const catalog = publication([qualified], { statuses: [
      { id: 'not-tested', version: '1.0.0', name: 'Not tested', digest: '1'.repeat(64), status: 'approved', qualification: 'needs-testing', createdAt: '2026-10-11T12:00:00Z' },
      { id: 'withdrawn', version: '1.0.0', name: 'Withdrawn', digest: '2'.repeat(64), status: 'revoked', qualification: 'revoked', createdAt: '2026-10-11T12:00:00Z' }
    ] });
    expect(items(renderReleasesFeed(catalog)).map(item => item.title)).toEqual(['Synthetic Skill · v1.0.0']);
    const unqualified = structuredClone(qualified);
    unqualified.skill.qualification = 'needs-testing';
    expect(() => renderReleasesFeed(publication([unqualified]))).toThrow('Unqualified content');
    const tampered = structuredClone(qualified);
    tampered.bundle.files['SKILL.md'] = '# Altered after approval';
    expect(() => renderReleasesFeed(publication([tampered]))).toThrow('catalog digest');
  });

  it('deduplicates announcements before the shared feed window is applied', () => {
    const article = insight();
    const site = resource();
    const catalog = publication([publishedSkill()]);
    const unique = items(renderUpdatesFeed([article, article], [site, site], catalog));
    expect(unique).toHaveLength(3);
    expect(new Set(unique.map(item => item.guid)).size).toBe(3);
  });

  it.each(['not-a-date', '2026-02-30T10:00:00Z', '2026-10-11T09:30:00', '2026-10-11T24:00:00Z'])('rejects an invalid release timestamp %s rather than inventing a publication date', (date) => {
    expect(() => renderReleasesFeed(publication([publishedSkill({ release: { maintainedAt: date } })]))).toThrow('Invalid RSS');
  });

  it('supports a truly empty catalog without claiming a publication time', () => {
    const empty = validatePublication({ schema: 'skillflux-publication/v2', repo: null, commitSha: null, fetchedAt: null, items: [] });
    const xml = renderReleasesFeed(empty);
    expect(items(xml)).toEqual([]);
    expect(xml).not.toContain('<lastBuildDate>');
    expect(renderUpdatesFeed([], [], empty)).not.toContain('<lastBuildDate>');
  });
});
