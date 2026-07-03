import { getCollection } from "astro:content";
import { absoluteUrl, renderLlmsText, type InsightSummary } from "../lib/content";

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

  return new Response(renderLlmsText(new Date().toISOString(), insights), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
