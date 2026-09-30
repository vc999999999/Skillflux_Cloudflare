import { getSites } from '../lib/content';
import { getGuides } from '../lib/guides';
import { getSiteCopy, localizePath, type Language } from '../lib/i18n';
import { getPublication, skillPath } from '../lib/publication';
import { scenarios } from '../lib/scenarios';
import type { GlobalSearchEntry } from '../lib/global-search';

export const prerender = true;

export function GET() {
  const publication = getPublication();
  const entries: GlobalSearchEntry[] = [];
  for (const lang of ['zh', 'en'] as Language[]) {
    for (const site of getSites()) {
      const copy = getSiteCopy(site, lang);
      entries.push({ id: `source:${site.slug}:${lang}`, lang, kind: 'source', title: copy.name, description: copy.tagline,
        href: localizePath(`/resource/${site.resourceSlug}/`, lang), keywords: `${site.name} ${site.summary} ${copy.summary} ${site.tags.join(' ')} ${copy.tags.join(' ')} ${site.category} ${site.type}` });
    }
    for (const guide of getGuides()) entries.push({ id: `guide:${guide.slug}:${lang}`, lang, kind: 'guide', title: guide.title[lang], description: guide.description[lang], href: localizePath(`/guides/${guide.slug}/`, lang), keywords: `${guide.title.zh} ${guide.title.en}` });
    for (const scenario of scenarios) entries.push({ id: `scenario:${scenario.slug}:${lang}`, lang, kind: 'guide', title: scenario.title[lang], description: scenario.summary[lang], href: localizePath(`/scenarios/${scenario.slug}/`, lang), keywords: scenario.sections.map(section => `${section.title[lang]} ${section.body[lang]}`).join(' ') });
    for (const { skill } of publication.latest) entries.push({ id: `skill:${skill.id}:${lang}`, lang, kind: 'skill', title: skill.name, description: skill.description, href: localizePath(skillPath(skill.id), lang), keywords: `${skill.id} ${skill.tags.join(' ')} ${skill.hosts.join(' ')} ${skill.publisher}` });
    const pages = [
      { path: '/install/', zh: '安装与接入 SkillFlux', en: 'Install and connect SkillFlux', description: { zh: '配置本地 CLI、MCP 与项目入口。', en: 'Set up the local CLI, MCP server and project entry point.' }, keywords: '安装 配置 接入 npm CLI MCP install setup init codex claude cursor' },
      { path: '/for-ai/', zh: 'For AI · 机器可读入口', en: 'For AI · Machine-readable endpoints', description: { zh: '获取 llms.txt、JSON 索引与 RSS。', en: 'Read llms.txt, JSON indexes and RSS feeds.' }, keywords: 'AI llms.txt JSON RSS 索引 agent' },
      { path: '/submit/', zh: '提交资源', en: 'Submit a resource', description: { zh: '推荐值得收录的 Skill 与 AI 工具。', en: 'Suggest a skill source or AI tool for the directory.' }, keywords: '提交 投稿 贡献 submit contribute' },
      { path: '/registry/', zh: '精品 Skill', en: 'Curated skills', description: { zh: '浏览已批准并通过实测的具体 Skill 版本。', en: 'Browse approved skill releases with recorded usage tests.' }, keywords: 'registry 安装 install approved 评测' },
      { path: '/quality/', zh: '收录与质检标准', en: 'Curation and quality standards', description: { zh: '了解来源收录、自动检查与人工实测。', en: 'Understand source listings, automated checks and human evaluation.' }, keywords: 'quality safety 质量 安全 审核 标准' }
    ];
    for (const page of pages) entries.push({ id: `page:${page.path}:${lang}`, lang, kind: 'page', title: page[lang], description: page.description[lang], href: localizePath(page.path, lang), keywords: page.keywords });
  }
  return new Response(JSON.stringify({ version: 1, entries }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
