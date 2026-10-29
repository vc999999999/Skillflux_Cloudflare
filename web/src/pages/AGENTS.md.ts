import { renderAgentsMd } from "../lib/data-discovery";

export const prerender = true;

export function GET() {
  return new Response(renderAgentsMd(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" }
  });
}
