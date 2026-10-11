import { getCollection } from 'astro:content';
import { renderInsightsFeed } from '../../lib/rss';

export const prerender = true;

export async function GET() {
  const entries = await getCollection('insights', entry => !entry.data.draft);
  return new Response(renderInsightsFeed(entries), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' }
  });
}
