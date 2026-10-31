// Comparison views over directory sources: alternatives to one source, a
// side-by-side of two, and topic roundups. Everything is derived from the
// catalog, editorial records and sampled source audits, so the pages change
// only when that data changes.
import type { SourceAudit } from '@skillflux/bench/schema';
import { getIndexableSites, type Site } from './content';
import { getSourceAudit } from './source-audits';
import { USE_CASES } from './use-cases';

export type Lang = 'en' | 'zh';

/** One-line sample result, e.g. "20 sampled · 2 fail a check · 1 no license". */
export function auditLine(audit: SourceAudit, lang: Lang): string {
  const s = audit.summary;
  if (lang === 'zh') {
    return [`抽样 ${s.sampled} 个，可检查 ${s.checked} 个`, `${s.failingAnyCheck} 个有失败项`, `${s.missingTrigger} 个未说明何时使用`, `${s.noLicense} 个无许可证`].join(' · ');
  }
  return [`${s.checked} of ${s.sampled} sampled entries checked`, `${s.failingAnyCheck} fail a check`, `${s.missingTrigger} lack a "when to use"`, `${s.noLicense} without a license`].join(' · ');
}

/**
 * Share of checked sampled skills with no failing check, a "when to use"
 * description and a license. Entries that could not be checked count against
 * the source. Null when the source has no audit.
 */
export function sampleScore(audit: SourceAudit | undefined): number | null {
  if (!audit || audit.summary.sampled === 0) return null;
  const clean = audit.items.filter(item => item.outcome === 'checked'
    && (item.counts?.fail ?? 0) === 0
    && item.statuses['frontmatter.descriptionTrigger'] === 'pass'
    && !item.flags.includes('no-license')).length;
  return clean / audit.summary.sampled;
}

export function pct(value: number): string { return `${Math.round(value * 100)}%`; }

function sharedUseCases(a: Site, b: Site): number {
  const left = new Set(a.editorial?.useCases ?? []);
  return (b.editorial?.useCases ?? []).filter(item => left.has(item)).length;
}

/** Sources that serve the same purpose, most similar first. */
export function alternativesFor(site: Site, limit = 6): Site[] {
  const primary = site.editorial?.useCases[0];
  const curated = site.editorial?.alternativeSlugs ?? [];
  return getIndexableSites()
    .filter(candidate => candidate.slug !== site.slug && sharedUseCases(site, candidate) > 0)
    .map(candidate => ({
      candidate,
      score: [
        curated.includes(candidate.slug) ? 1 : 0,
        candidate.editorial?.useCases[0] === primary ? 1 : 0,
        sharedUseCases(site, candidate),
        candidate.category === site.category ? 1 : 0,
        getSourceAudit(candidate.slug) ? 1 : 0,
      ],
    }))
    .sort((a, b) => {
      for (let index = 0; index < a.score.length; index++) if (a.score[index] !== b.score[index]) return b.score[index]! - a.score[index]!;
      return a.candidate.slug.localeCompare(b.candidate.slug);
    })
    .slice(0, limit)
    .map(item => item.candidate);
}

export type ComparePair = { slug: string; a: Site; b: Site };

export function compareSlug(a: Site, b: Site): string {
  const [left, right] = [a.resourceSlug, b.resourceSlug].sort();
  return `${left}-vs-${right}`;
}

/** Every pair named as an editorial alternative, once, in a stable order. */
export function comparePairs(): ComparePair[] {
  const sites = getIndexableSites();
  const bySlug = new Map(sites.map(site => [site.slug, site]));
  const pairs = new Map<string, ComparePair>();
  for (const site of sites) {
    for (const other of site.editorial?.alternativeSlugs ?? []) {
      const b = bySlug.get(other);
      if (!b) continue;
      const [left, right] = [site, b].sort((x, y) => x.resourceSlug.localeCompare(y.resourceSlug));
      const slug = compareSlug(left!, right!);
      if (!pairs.has(slug)) pairs.set(slug, { slug, a: left!, b: right! });
    }
  }
  return [...pairs.values()].sort((x, y) => x.slug.localeCompare(y.slug));
}

export function comparePairsFor(site: Site): ComparePair[] {
  return comparePairs().filter(pair => pair.a.slug === site.slug || pair.b.slug === site.slug);
}

export type BestTopic = {
  slug: string;
  title: { en: string; zh: string };
  intro: { en: string; zh: string };
  sites: Site[];
};

const CATEGORY_TOPICS: Array<{ slug: string; category: string; title: BestTopic['title']; intro: BestTopic['intro'] }> = [
  { slug: 'official-vendor-skills', category: 'official', title: { en: 'Official agent skill repositories from vendors', zh: '厂商官方 Agent Skill 仓库' }, intro: { en: 'Skills published by the teams that build the product: platform docs turned into instructions an agent can follow.', zh: '由产品团队自己发布的 Skill：把平台文档变成 Agent 能执行的指令。' } },
  { slug: 'skill-marketplaces', category: 'marketplace', title: { en: 'Agent skill marketplaces', zh: 'Agent Skill 市场' }, intro: { en: 'Sites and repositories built to browse and install skills or plugins, often with their own installer.', zh: '用于浏览和安装 Skill 或插件的网站与仓库，通常自带安装工具。' } },
  { slug: 'skill-directories', category: 'directory', title: { en: 'Agent skill directories', zh: 'Agent Skill 导航目录' }, intro: { en: 'Directories that index skills from many publishers; useful for discovery, not a quality signal on their own.', zh: '聚合多家发布者 Skill 的目录，适合发现，本身不代表质量。' } },
];

/** Roundups by use case and by source type; a topic needs at least four sources. */
export function bestTopics(): BestTopic[] {
  const sites = getIndexableSites();
  const topics: BestTopic[] = [];
  for (const [slug, label] of Object.entries(USE_CASES)) {
    const members = sites.filter(site => site.editorial?.useCases.includes(slug));
    if (members.length < 4) continue;
    topics.push({
      slug: slug === 'discover-skills' ? 'skill-discovery' : slug,
      title: { en: `Agent skill sources: ${label.en}`, zh: `Agent Skill 来源：${label.zh}` },
      intro: { en: `Sources whose main purposes include “${label.en}”.`, zh: `主要用途包含「${label.zh}」的来源。` },
      sites: members,
    });
  }
  for (const topic of CATEGORY_TOPICS) {
    const members = sites.filter(site => site.category === topic.category);
    if (members.length >= 4) topics.push({ slug: topic.slug, title: topic.title, intro: topic.intro, sites: members });
  }
  return topics.map(topic => ({ ...topic, sites: rankSites(topic.sites) }));
}

/** Audited sources first, by sample score; then the rest alphabetically. The order is stated on the page. */
export function rankSites(sites: Site[]): Site[] {
  return [...sites].sort((a, b) => {
    const left = sampleScore(getSourceAudit(a.slug));
    const right = sampleScore(getSourceAudit(b.slug));
    if (left !== null && right !== null && left !== right) return right - left;
    if ((left === null) !== (right === null)) return left === null ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}
