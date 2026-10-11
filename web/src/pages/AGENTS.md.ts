import { renderAgentsMd } from "../lib/content";

export const prerender = true;

export async function GET() {
  return new Response(renderAgentsMd(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8"
    }
  });
}
