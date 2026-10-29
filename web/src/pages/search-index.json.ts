import { getSites } from '../lib/content';
import { getGuides } from '../lib/guides';
import { getSiteCopy, localizePath, type Language } from '../lib/i18n';
import { scenarios } from '../lib/scenarios';
import { getIndexableSkillViews } from '../lib/skills';
import type { GlobalSearchEntry } from '../lib/global-search';

export const prerender = true;

export function GET() {
  const entries: GlobalSearchEntry[] = [];
  for (const lang of ['zh', 'en'] as Language[]) {
    for (const site of getSites()) {
      const copy = getSiteCopy(site, lang);
      entries.push({ id: `source:${site.slug}:${lang}`, lang, kind: 'source', title: copy.name, description: copy.tagline,
        href: localizePath(`/resource/${site.resourceSlug}/`, lang), keywords: `${site.name} ${site.summary} ${copy.summary} ${site.tags.join(' ')} ${copy.tags.join(' ')} ${site.category} ${site.type}` });
    }
    for (const view of getIndexableSkillViews()) entries.push({ id: `skill:${view.skill.id}:${lang}`, lang, kind: 'skill', title: view.skill.displayName[lang], description: view.skill.summary[lang], href: localizePath(`/skills/${view.skill.id}/`, lang), keywords: `${view.skill.name} ${view.skill.author.name} ${view.skill.tags.join(' ')} ${view.category.label.en} ${view.category.label.zh}` });
    for (const guide of getGuides()) entries.push({ id: `guide:${guide.slug}:${lang}`, lang, kind: 'guide', title: guide.title[lang], description: guide.description[lang], href: localizePath(`/guides/${guide.slug}/`, lang), keywords: `${guide.title.zh} ${guide.title.en}` });
    for (const scenario of scenarios) entries.push({ id: `scenario:${scenario.slug}:${lang}`, lang, kind: 'guide', title: scenario.title[lang], description: scenario.summary[lang], href: localizePath(`/scenarios/${scenario.slug}/`, lang), keywords: scenario.sections.map(section => `${section.title[lang]} ${section.body[lang]}`).join(' ') });
    const pages = [
      { path: '/data/', zh: '开放数据集', en: 'Open dataset', description: { zh: '下载 Skill 体检与实测数据（CC BY 4.0）。', en: 'Download skill health check and benchmark data (CC BY 4.0).' }, keywords: 'data dataset csv json download 数据 下载' },
      { path: '/methodology/v1/', zh: '方法论 v1', en: 'Methodology v1', description: { zh: '静态体检与对照实测的完整方法。', en: 'How the health check and the benchmark work.' }, keywords: 'methodology method benchmark wilson 方法 统计' },
      { path: '/for-ai/', zh: 'For AI · 机器可读入口', en: 'For AI · Machine-readable endpoints', description: { zh: '获取 llms.txt、JSON 索引与 RSS。', en: 'Read llms.txt, JSON indexes and RSS feeds.' }, keywords: 'AI llms.txt JSON RSS 索引 agent' },
      { path: '/submit/', zh: '提交资源', en: 'Submit a resource', description: { zh: '推荐值得收录的 Skill 与 AI 工具。', en: 'Suggest a skill source or AI tool for the directory.' }, keywords: '提交 投稿 贡献 submit contribute' },
      { path: '/quality/', zh: '收录标准', en: 'Listing policy', description: { zh: '了解来源如何被收录、复核与下架。', en: 'How sources are listed, reviewed and delisted.' }, keywords: 'quality safety 质量 安全 审核 标准' }
    ];
    for (const page of pages) entries.push({ id: `page:${page.path}:${lang}`, lang, kind: 'page', title: page[lang], description: page.description[lang], href: localizePath(page.path, lang), keywords: page.keywords });
  }
  return new Response(JSON.stringify({ version: 1, entries }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
