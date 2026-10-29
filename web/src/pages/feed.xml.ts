import { getCollection } from 'astro:content';
import { renderUpdatesFeed } from '../lib/rss';

export const prerender = true;

export async function GET() {
  const entries = await getCollection('insights', entry => !entry.data.draft);
  return new Response(renderUpdatesFeed(entries), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8"
    }
  });
}
