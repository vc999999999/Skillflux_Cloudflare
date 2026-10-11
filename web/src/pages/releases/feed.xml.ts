import { getPublication } from '../../lib/publication';
import { renderReleasesFeed } from '../../lib/rss';

export const prerender = true;

export function GET() {
  return new Response(renderReleasesFeed(getPublication()), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' }
  });
}
