import type { APIRoute } from "astro";
import { sourceMarkdown } from "../../lib/ai-layer";
import { getIndexableSites, type Site } from "../../lib/content";

export const prerender = true;

export function getStaticPaths() {
  return getIndexableSites().map(site => ({ params: { slug: site.resourceSlug }, props: { site } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(sourceMarkdown((props as { site: Site }).site), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
