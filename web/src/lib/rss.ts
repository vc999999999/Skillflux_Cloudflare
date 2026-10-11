import { createHash } from 'node:crypto';
import type { CollectionEntry } from 'astro:content';
import { SITE } from '../config';
import { absoluteUrl, getIndexableSites, type Site } from './content';
import { skillPath, type Publication } from './publication';

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

function contentDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid RSS content date: ${date}`);
  }
  return date;
}

function releaseDate(date: string): string {
  // Catalog releases can have date-only values or full timestamps with offsets.
  // Normalize only the presentation; the release identity never depends on time.
  // A datetime without a zone would make the RSS depend on the build machine.
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  if (!isoDate.test(date) && !isoTimestamp.test(date)) throw new Error(`Invalid RSS release date: ${date}`);
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) throw new Error(`Invalid RSS release date: ${date}`);
  contentDate(date.slice(0, 10));
  return value.toISOString();
}

function feedDate(date: string): string {
  return new Date(date).toUTCString();
}

export function resourceFeedItems(sites: Site[] = getIndexableSites()): FeedItem[] {
  return sites.filter(site => site.indexable).map(site => {
    const url = absoluteUrl(`/resource/${site.resourceSlug}/`);
    return {
      title: site.name,
      url,
      description: `${site.tagline} ${site.summary}`,
      category: '资源更新',
      updatedAt: contentDate(site.updatedAt),
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
      updatedAt: contentDate(entry.data.dateModified),
      guid: revisionGuid(url, { data: entry.data, body: entry.body ?? '' })
    };
  });
}

/** Only the qualified, integrity-checked publication items become release announcements. */
export function releaseFeedItems(publication: Publication): FeedItem[] {
  const repo = publication.snapshot.repo;
  if (!repo) return [];
  return publication.items.map(({ skill }) => ({
    title: `${skill.name} · v${skill.version}`,
    url: absoluteUrl(skillPath(skill.id, skill.version)),
    description: [
      skill.description,
      `更新说明：${skill.release?.notes ?? '此版本未提供单独更新说明，请查看版本详情。'}`,
      `破坏性变更：${skill.release ? (skill.release.breaking ? '有，请先审阅更新说明。' : '发布者未标记破坏性变更。') : '未声明。'}`,
      `最低客户端版本：${skill.release?.minClientVersion ?? '未声明'}。`,
      '这是已发布版本公告；是否适合升级，请在项目内执行 skillflux.check_updates 检查已安装版本、宿主与依赖。',
      `目录来源：https://github.com/${repo}`
    ].join('\n'),
    category: 'Skill 版本发布',
    updatedAt: releaseDate(skill.release?.maintainedAt ?? skill.createdAt),
    // Versions are immutable. Rebuilding, changing catalog commits or editing
    // editorial descriptions must not announce the same package a second time.
    guid: `urn:skillflux:release:${repo.toLowerCase()}:${encodeURIComponent(skill.id)}:${encodeURIComponent(skill.version)}`
  }));
}

function renderRss(items: FeedItem[], feedPath: string, title: string, description: string, pagePath: string): string {
  const unique = [...new Map(items.map(item => [item.guid, item])).values()];
  const ordered = unique.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    || a.url.localeCompare(b.url) || a.guid.localeCompare(b.guid)).slice(0, 30);
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

export function renderUpdatesFeed(entries: Insight[], sites: Site[] = getIndexableSites(), publication?: Publication): string {
  return renderRss([...resourceFeedItems(sites), ...insightFeedItems(entries), ...(publication ? releaseFeedItems(publication) : [])], '/feed.xml',
    `${SITE.name} · 内容更新`, 'Skill 合格版本发布、资源新增、能力说明更新与 Skill 拆解文章。', '/');
}

export function renderInsightsFeed(entries: Insight[]): string {
  return renderRss(insightFeedItems(entries), '/insights/feed.xml', `${SITE.name} · Skill 拆解`,
    'Skill 拆解文章的发布与修订：工作流程、判断依据、使用局限与原始来源。', '/insights/');
}

export function renderReleasesFeed(publication: Publication): string {
  return renderRss(releaseFeedItems(publication), '/releases/feed.xml', `${SITE.name} · Skill 版本发布`,
    '仅订阅已通过资格验证的 Skill 包版本、更新说明与兼容性声明；项目内的更新检查决定具体可升级项。', '/registry/');
}
