import { renderLlmsFullText } from "../lib/content";

export const prerender = true;

export function GET() {
  return new Response(renderLlmsFullText(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
