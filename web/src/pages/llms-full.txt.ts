import { renderLlmsFullText } from "../lib/content";
import { renderDiscoveryText } from '../lib/discovery';

export const prerender = true;

export function GET() {
  return new Response(renderLlmsFullText() + renderDiscoveryText(true), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
