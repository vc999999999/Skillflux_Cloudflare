import { getCollection } from "astro:content";
import { absoluteUrl, renderLlmsText, type InsightSummary } from "../lib/content";
import { renderDiscoveryText } from '../lib/discovery';

export const prerender = true;

export async function GET() {
  const entries = await getCollection("insights", (entry) => !entry.data.draft);
  const insights: InsightSummary[] = entries
    .sort((a, b) => b.data.datePublished.localeCompare(a.data.datePublished))
    .map((entry) => ({
      title: entry.data.title,
      tldr: entry.data.tldr,
      url: absoluteUrl(`/insights/${entry.id}/`)
    }));

  return new Response(renderLlmsText(new Date().toISOString(), insights) + renderDiscoveryText(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
