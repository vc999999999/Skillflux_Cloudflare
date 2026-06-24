import { renderLlmsText } from "../lib/content";

export const prerender = true;

export function GET() {
  return new Response(renderLlmsText(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
