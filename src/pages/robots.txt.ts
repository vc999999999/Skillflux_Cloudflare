import { renderRobotsTxt } from "../lib/content";

export const prerender = true;

export function GET() {
  return new Response(renderRobotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
