import { renderFeedXml } from "../lib/content";

export const prerender = true;

export function GET() {
  return new Response(renderFeedXml(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8"
    }
  });
}
