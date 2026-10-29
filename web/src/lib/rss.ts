import { createHash } from 'node:crypto';
import type { CollectionEntry } from 'astro:content';
import { SITE } from '../config';
import { absoluteUrl, getIndexableSites, type Site } from './content';
import { getSiteCopy, insightPath, localizePath, type Language } from './i18n';
import { keyFinding } from './skill-data';
import { getRuns, getSkillView } from './skills';
import type { RunRecord } from '@skillflux/bench/schema';

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

function feedDate(date: string): string {
  return new Date(date).toUTCString();
}

export function resourceFeedItems(sites: Site[] = getIndexableSites(), lang: Language = 'en'): FeedItem[] {
  return sites.filter(site => site.indexable).map(site => {
    const url = absoluteUrl(localizePath(`/resource/${site.resourceSlug}/`, lang));
    const copy = getSiteCopy(site, lang);
    return {
      title: copy.name,
      url,
      description: `${copy.tagline} ${copy.summary}`,
      category: lang === 'zh' ? '资源更新' : 'Resource update',
      updatedAt: contentDate(site.updatedAt),
      guid: revisionGuid(url, site)
    };
  });
}

/** Articles keep the language they were written in, whichever feed carries them. */
export function insightFeedItems(entries: Insight[], lang: Language = 'en'): FeedItem[] {
  return entries.filter(entry => !entry.data.draft).map(entry => {
    const url = absoluteUrl(insightPath(entry));
    return {
      title: entry.data.title,
      url,
      description: `${entry.data.tldr} ${lang === 'zh' ? '来源' : 'Source'}: ${entry.data.source.repo}`,
      category: lang === 'zh' ? 'Skill 拆解' : 'Skill deep-dive',
      updatedAt: contentDate(entry.data.dateModified),
      guid: revisionGuid(url, { data: entry.data, body: entry.body ?? '' })
    };
  });
}

/** One item per skill in each published run. Runs are immutable, so the GUID never changes. */
export function benchmarkFeedItems(runs: RunRecord[] = getRuns(), lang: Language = 'en'): FeedItem[] {
  return runs.filter(run => run.status === 'published').flatMap(run => run.skills.flatMap(result => {
    const view = getSkillView(result.skillId);
    if (!view?.indexable || view.result?.run.runId !== run.runId) return [];
    return [{
      title: lang === 'zh' ? `${view.skill.displayName.zh} 实测结果（批次 ${run.runId}）` : `${view.skill.displayName.en} benchmark results (run ${run.runId})`,
      url: absoluteUrl(localizePath(`/skills/${result.skillId}/`, lang)),
      description: keyFinding(view, lang),
      category: lang === 'zh' ? '实测报告' : 'Benchmark report',
      updatedAt: contentDate(run.publishedAt),
      guid: `urn:skillflux:bench:${run.runId}:${result.skillId}:${lang}`,
    }];
  }));
}

function renderRss(items: FeedItem[], feedPath: string, title: string, description: string, pagePath: string, language = 'en'): string {
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
    `    <language>${language}</language>`,
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

export function renderUpdatesFeed(entries: Insight[], sites: Site[] = getIndexableSites(), lang: Language = 'en'): string {
  const items = [...benchmarkFeedItems(undefined, lang), ...resourceFeedItems(sites, lang), ...insightFeedItems(entries, lang)];
  return lang === 'zh'
    ? renderRss(items, '/zh/feed.xml', `${SITE.name} · 内容更新`, '实测报告、新收录来源与 Skill 拆解文章。', '/zh/', 'zh-CN')
    : renderRss(items, '/feed.xml', `${SITE.name} · Updates`, 'Benchmark reports, new sources and skill deep-dives.', '/');
}

export function renderInsightsFeed(entries: Insight[]): string {
  return renderRss(insightFeedItems(entries, 'zh'), '/insights/feed.xml', `${SITE.name} · Skill 拆解`,
    'Skill 拆解文章的发布与修订：工作流程、判断依据、使用局限与原始来源。', '/zh/insights/', 'zh-CN');
}

export function renderBenchmarksFeed(lang: Language = 'en'): string {
  return lang === 'zh'
    ? renderRss(benchmarkFeedItems(undefined, 'zh'), '/zh/benchmarks/feed.xml', `${SITE.name} · 实测报告`, '每个已发布测试批次中每个 Skill 的结果。', '/zh/benchmarks/', 'zh-CN')
    : renderRss(benchmarkFeedItems(undefined, 'en'), '/benchmarks/feed.xml', `${SITE.name} · Benchmark reports`, 'Results for each skill in each published benchmark run.', '/benchmarks/');
}
