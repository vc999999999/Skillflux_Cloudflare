import { createHash } from 'node:crypto';
import type { CollectionEntry } from 'astro:content';
import { SITE } from '../config';
import { absoluteUrl, getIndexableSites, type Site } from './content';

type Insight = Pick<CollectionEntry<'insights'>, 'id' | 'data' | 'body'>;
type FeedItem = {
  title: string;
  url: string;
  description: string;
  category: string;
  updatedAt: string;
  guid: string;
};

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function stableContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableContent);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableContent(entry)]));
  }
  return value;
}

// These feeds announce content revisions, not just the first publication of a URL.
// Content, not build time, identifies an update, including edits made on the same day.
function revisionGuid(url: string, content: unknown): string {
  const revision = createHash('sha256').update(JSON.stringify(stableContent(content))).digest('hex').slice(0, 24);
  return `${url}#revision-${revision}`;
}

function feedDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid RSS content date: ${date}`);
  }
  return value.toUTCString();
}

export function resourceFeedItems(sites: Site[] = getIndexableSites()): FeedItem[] {
  return sites.filter(site => site.indexable).map(site => {
    const url = absoluteUrl(`/resource/${site.resourceSlug}/`);
    return {
      title: site.name,
      url,
      description: `${site.tagline} ${site.summary}`,
      category: '资源更新',
      updatedAt: site.updatedAt,
      guid: revisionGuid(url, site)
    };
  });
}

export function insightFeedItems(entries: Insight[]): FeedItem[] {
  return entries.filter(entry => !entry.data.draft).map(entry => {
    const url = absoluteUrl(`/insights/${entry.id}/`);
    return {
      title: entry.data.title,
      url,
      description: `${entry.data.tldr} 来源: ${entry.data.source.repo}`,
      category: 'Skill 拆解',
      updatedAt: entry.data.dateModified,
      guid: revisionGuid(url, { data: entry.data, body: entry.body ?? '' })
    };
  });
}

function renderRss(items: FeedItem[], feedPath: string, title: string, description: string, pagePath: string): string {
  const ordered = items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.url.localeCompare(b.url)).slice(0, 30);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(absoluteUrl(pagePath))}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    '    <language>zh-CN</language>',
    `    <atom:link href="${escapeXml(absoluteUrl(feedPath))}" rel="self" type="application/rss+xml" />`,
    ...(ordered[0] ? [`    <lastBuildDate>${feedDate(ordered[0].updatedAt)}</lastBuildDate>`] : []),
    ...ordered.map(item => [
      '    <item>',
      `      <title>${escapeXml(item.title)}</title>`,
      `      <link>${escapeXml(item.url)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
      `      <description>${escapeXml(item.description)}</description>`,
      `      <category>${escapeXml(item.category)}</category>`,
      `      <pubDate>${feedDate(item.updatedAt)}</pubDate>`,
      '    </item>'
    ].join('\n')),
    '  </channel>',
    '</rss>'
  ].join('\n');
}

export function renderUpdatesFeed(entries: Insight[], sites: Site[] = getIndexableSites()): string {
  return renderRss([...resourceFeedItems(sites), ...insightFeedItems(entries)], '/feed.xml',
    `${SITE.name} · 内容更新`, 'Skill 资源新增、能力说明更新与 Skill 拆解文章。', '/');
}

export function renderInsightsFeed(entries: Insight[]): string {
  return renderRss(insightFeedItems(entries), '/insights/feed.xml', `${SITE.name} · Skill 拆解`,
    'Skill 拆解文章的发布与修订：工作流程、判断依据、使用局限与原始来源。', '/insights/');
}
