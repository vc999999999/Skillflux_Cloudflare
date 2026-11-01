import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { insightPath, type Language } from '../lib/i18n';
import { buildSearchEntries } from '../lib/search-index';

export const prerender = true;

// One file per language, so the search dialog downloads only the language it shows.
export function getStaticPaths() {
  return (['en', 'zh'] as Language[]).map(lang => ({ params: { lang } }));
}

export const GET: APIRoute = async ({ params }) => {
  const lang = params.lang as Language;
  const insights = (await getCollection('insights', entry => !entry.data.draft && entry.data.lang === lang))
    .map(entry => ({ id: entry.id, href: insightPath(entry), title: entry.data.title, description: entry.data.description, keywords: `${entry.data.skillName} ${entry.data.industry} ${entry.data.scenarios.join(' ')}` }));
  return new Response(JSON.stringify({ version: 2, entries: buildSearchEntries(lang, insights) }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
