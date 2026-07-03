import { getCollection } from "astro:content";
import { SITE } from "../../config";
import { absoluteUrl } from "../../lib/content";

export const prerender = true;

const FEED_TITLE = `${SITE.name} · Skill 拆解`;
const FEED_DESCRIPTION = "各行业 skill 的精华流程与痛点拆解：编码的经验流程、专家判断、局限与来源署名。";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET() {
  const entries = (await getCollection("insights", (entry) => !entry.data.draft)).sort((a, b) =>
    b.data.datePublished.localeCompare(a.data.datePublished)
  );

  const items = entries
    .map((entry) => {
      const pageUrl = absoluteUrl(`/insights/${entry.id}/`);
      return [
        "    <item>",
        `      <title>${escapeXml(entry.data.title)}</title>`,
        `      <link>${escapeXml(pageUrl)}</link>`,
        `      <guid>${escapeXml(pageUrl)}</guid>`,
        `      <description>${escapeXml(`${entry.data.tldr} 来源: ${entry.data.source.repo}`)}</description>`,
        `      <category>${escapeXml(entry.data.industry)}</category>`,
        `      <pubDate>${new Date(`${entry.data.datePublished}T00:00:00.000Z`).toUTCString()}</pubDate>`,
        "    </item>"
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(FEED_TITLE)}</title>`,
    `    <link>${escapeXml(absoluteUrl("/insights/"))}</link>`,
    `    <description>${escapeXml(FEED_DESCRIPTION)}</description>`,
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>"
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8"
    }
  });
}
