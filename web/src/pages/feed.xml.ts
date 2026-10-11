import { getCollection } from 'astro:content';
import { renderUpdatesFeed } from '../lib/rss';
import { getPublication } from '../lib/publication';

export const prerender = true;

export async function GET() {
  const entries = await getCollection('insights', entry => !entry.data.draft);
  return new Response(renderUpdatesFeed(entries, undefined, getPublication()), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8"
    }
  });
}
