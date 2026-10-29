import { renderLlmsFullText } from "../lib/content";
import { renderDataText } from '../lib/data-discovery';
import { renderDiscoveryText } from '../lib/discovery';

export const prerender = true;

export function GET() {
  return new Response(renderDataText(true) + renderLlmsFullText() + renderDiscoveryText(true), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
