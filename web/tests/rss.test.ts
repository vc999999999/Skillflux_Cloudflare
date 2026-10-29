import { decodeXML } from 'entities';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { absoluteUrl, getIndexableSites, type Site } from '../src/lib/content';
import { renderInsightsFeed, renderUpdatesFeed } from '../src/lib/rss';

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
      lang: 'zh',
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
  it('serves English at /feed.xml and Chinese at /zh/feed.xml, keeping each article at its own language URL', () => {
    const article = insight();
    const site = resource();
    const english = renderUpdatesFeed([article], [site]);
    const chinese = renderUpdatesFeed([article], [site], 'zh');
    expect(element(english, 'language')).toBe('en');
    expect(element(chinese, 'language')).toBe('zh-CN');
    expect(items(english).map(item => item.link)).toContain(absoluteUrl(`/resource/${site.resourceSlug}/`));
    expect(items(chinese).map(item => item.link)).toContain(absoluteUrl(`/zh/resource/${site.resourceSlug}/`));
    for (const xml of [english, chinese]) expect(items(xml).map(item => item.link)).toContain(absoluteUrl(`/zh/insights/${article.id}/`));
  });

  it('includes published articles alongside resources, while excluding drafts and non-indexable resources', () => {
    const published = insight();
    const draft = insight('unpublished-draft', { draft: true, dateModified: '2026-10-11' });
    const visible = resource();
    const hidden = { ...resource(), resourceSlug: 'hidden-resource', indexable: false };

    const main = items(renderUpdatesFeed([draft, published], [hidden, visible]));
    expect(main.map(item => item.link).sort()).toEqual([
      absoluteUrl(`/zh/insights/${published.id}/`),
      absoluteUrl(`/resource/${visible.resourceSlug}/`)
    ].sort());
    expect(items(renderInsightsFeed([draft, published])).map(item => item.link)).toEqual([
      absoluteUrl(`/zh/insights/${published.id}/`)
    ]);
  });

  it('uses the same article revision identity in both subscriptions', () => {
    const article = insight();
    const main = renderUpdatesFeed([article], []);
    const focused = renderInsightsFeed([article]);
    expect(items(main)[0]!.guid).toBe(items(focused)[0]!.guid);
    expect(main).toContain('<guid isPermaLink="false">');
    expect(focused).toContain('<guid isPermaLink="false">');
    expect(items(main)[0]!.link).toBe(absoluteUrl(`/zh/insights/${article.id}/`));
  });

  it.each(['article body', 'resource capability'] as const)('delivers exactly one new item to an existing reader after a same-day edit to %s', (change) => {
    const article = insight();
    const site = resource();
    const before = items(renderUpdatesFeed([article], [site]));
    const readGuids = new Set(before.map(item => item.guid));
    let changedUrl: string;

    if (change === 'article body') {
      article.body = `${article.body ?? ''}\nA new example explains an additional failure case.`;
      changedUrl = absoluteUrl(`/zh/insights/${article.id}/`);
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
      expect(entries[0]!.link).toBe(absoluteUrl(`/zh/insights/${revised.id}/`));
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
    expect(items(xml)[0]!.link).toBe(absoluteUrl('/zh/insights/article-34/'));
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
      [renderInsightsFeed([]), '/insights/feed.xml'],
      [renderUpdatesFeed([], [], 'zh'), '/zh/feed.xml']
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
