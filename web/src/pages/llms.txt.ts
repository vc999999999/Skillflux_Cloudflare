import { getCollection } from "astro:content";
import { absoluteUrl, renderLlmsText, type InsightSummary } from "../lib/content";
import { renderDataText } from '../lib/data-discovery';
import { renderDiscoveryText } from '../lib/discovery';
import { insightPath } from '../lib/i18n';

export const prerender = true;

export async function GET() {
  const entries = await getCollection("insights", (entry) => !entry.data.draft);
  const insights: InsightSummary[] = entries
    .sort((a, b) => b.data.datePublished.localeCompare(a.data.datePublished))
    .map((entry) => ({
      title: entry.data.title,
      tldr: entry.data.tldr,
      url: absoluteUrl(insightPath(entry))
    }));

  return new Response(renderDataText() + renderLlmsText(new Date().toISOString(), insights) + renderDiscoveryText(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
