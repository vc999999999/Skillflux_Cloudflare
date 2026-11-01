import { getSites } from './content';
import { getGuides } from './guides';
import { getSiteCopy, localizePath, type Language } from './i18n';
import { scenarios } from './scenarios';
import { getIndexableSkillViews } from './skills';
import { bestTopics, comparePairs } from './source-compare';
import type { GlobalSearchEntry } from './global-search';

/** An insight article as the index needs it; the endpoint maps content-collection entries onto this. */
export type SearchInsight = { id: string; href: string; title: string; description: string; keywords: string };

const PAGES = [
  { path: '/data/', zh: '开放数据集', en: 'Open dataset', description: { zh: '下载 Skill 体检与实测数据（CC BY 4.0）。', en: 'Download skill health check and benchmark data (CC BY 4.0).' }, keywords: 'data dataset csv json download 数据 下载' },
  { path: '/methodology/v1/', zh: '方法论 v1', en: 'Methodology v1', description: { zh: '静态体检与对照实测的完整方法。', en: 'How the health check and the benchmark work.' }, keywords: 'methodology method benchmark wilson 方法 统计' },
  { path: '/for-ai/', zh: 'For AI · 机器可读入口', en: 'For AI · Machine-readable endpoints', description: { zh: '获取 llms.txt、JSON 索引与 RSS。', en: 'Read llms.txt, JSON indexes and RSS feeds.' }, keywords: 'AI llms.txt JSON RSS 索引 agent' },
  { path: '/submit/', zh: '提交资源', en: 'Submit a resource', description: { zh: '推荐值得收录的 Skill 与 AI 工具。', en: 'Suggest a skill source or AI tool for the directory.' }, keywords: '提交 投稿 贡献 submit contribute' },
  { path: '/quality/', zh: '收录标准', en: 'Listing policy', description: { zh: '了解来源如何被收录、复核与下架。', en: 'How sources are listed, reviewed and delisted.' }, keywords: 'quality safety 质量 安全 审核 标准' },
  { path: '/compare/', zh: '来源对比', en: 'Compare sources', description: { zh: '两两对比 Skill 来源的用途、抽样体检与许可证。', en: 'Side-by-side comparisons of skill sources: purpose, sample checks and licenses.' }, keywords: 'compare vs comparison 对比 比较' },
  { path: '/contact/', zh: '联系我们', en: 'Contact', description: { zh: '合作、更正与收录推荐的联系方式。', en: 'How to reach us about cooperation, corrections and suggestions.' }, keywords: 'contact email 联系 邮箱 反馈 feedback' }
];

/** Search entries for one language. Insight articles exist in a single language, so callers pass only that language's. */
export function buildSearchEntries(lang: Language, insights: SearchInsight[] = []): GlobalSearchEntry[] {
  const entries: GlobalSearchEntry[] = [];
  for (const site of getSites()) {
    const copy = getSiteCopy(site, lang);
    entries.push({ id: `source:${site.slug}:${lang}`, lang, kind: 'source', title: copy.name, description: copy.tagline,
      href: localizePath(`/resource/${site.resourceSlug}/`, lang), keywords: `${site.name} ${site.summary} ${copy.summary} ${site.tags.join(' ')} ${copy.tags.join(' ')} ${site.category} ${site.type}` });
  }
  for (const view of getIndexableSkillViews()) entries.push({ id: `skill:${view.skill.id}:${lang}`, lang, kind: 'skill', title: view.skill.displayName[lang], description: view.skill.summary[lang], href: localizePath(`/skills/${view.skill.id}/`, lang), keywords: `${view.skill.name} ${view.skill.author.name} ${view.skill.tags.join(' ')} ${view.category.label.en} ${view.category.label.zh}` });
  for (const insight of insights) entries.push({ id: `insight:${insight.id}:${lang}`, lang, kind: 'insight', title: insight.title, description: insight.description, href: insight.href, keywords: insight.keywords });
  for (const guide of getGuides()) entries.push({ id: `guide:${guide.slug}:${lang}`, lang, kind: 'guide', title: guide.title[lang], description: guide.description[lang], href: localizePath(`/guides/${guide.slug}/`, lang), keywords: `${guide.title.zh} ${guide.title.en}` });
  for (const scenario of scenarios) entries.push({ id: `scenario:${scenario.slug}:${lang}`, lang, kind: 'guide', title: scenario.title[lang], description: scenario.summary[lang], href: localizePath(`/scenarios/${scenario.slug}/`, lang), keywords: scenario.sections.map(section => `${section.title[lang]} ${section.body[lang]}`).join(' ') });
  for (const topic of bestTopics()) entries.push({ id: `roundup:${topic.slug}:${lang}`, lang, kind: 'roundup', title: topic.title[lang], description: topic.intro[lang], href: localizePath(`/best/${topic.slug}/`, lang), keywords: `${topic.title.en} ${topic.title.zh} best top roundup 盘点 推荐` });
  for (const pair of comparePairs()) {
    const a = getSiteCopy(pair.a, lang), b = getSiteCopy(pair.b, lang);
    entries.push({ id: `compare:${pair.slug}:${lang}`, lang, kind: 'compare', title: `${a.name} vs ${b.name}`, description: `${a.tagline} · ${b.tagline}`, href: localizePath(`/compare/${pair.slug}/`, lang), keywords: `${pair.a.name} ${pair.b.name} vs compare 对比` });
  }
  for (const page of PAGES) entries.push({ id: `page:${page.path}:${lang}`, lang, kind: 'page', title: page[lang], description: page.description[lang], href: localizePath(page.path, lang), keywords: page.keywords });
  return entries;
}
