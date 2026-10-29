import { renderBenchmarksFeed } from '../../../lib/rss';

export const prerender = true;

export function GET() {
  return new Response(renderBenchmarksFeed('zh'), { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
