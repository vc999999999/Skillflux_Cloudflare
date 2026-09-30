import type { Language } from "./i18n";

export type Guide = {
  slug: string;
  datePublished: string;
  dateModified: string;
  title: Record<Language, string>;
  description: Record<Language, string>;
};

// Editorial long-form. Bodies live in src/components/guides/<Component>.astro;
// this registry drives the index list, sitemap, and JSON-LD metadata.
export const guides: Guide[] = [
  {
    slug: "how-to-download-claude-skills",
    datePublished: "2026-06-30",
    dateModified: "2026-09-29",
    title: {
      zh: "Claude Skills 从哪里下载：来源与安装指南",
      en: "Where to download Claude Skills: sources and installation"
    },
    description: {
      zh: "了解厂商合集、市场、开源仓库与下载包的区别，追溯原始说明，选择适合任务的 Claude Skills 来源。",
      en: "Compare vendor collections, marketplaces, open-source repositories and packages, trace original instructions and choose a Claude Skills source for your task."
    }
  },
  {
    slug: "choosing-a-skill-source",
    datePublished: "2026-06-30",
    dateModified: "2026-09-29",
    title: {
      zh: "如何挑选 skill 来源：合集、市场、仓库怎么选",
      en: "How to choose a skill source: collections vs marketplaces vs repos"
    },
    description: {
      zh: "五类 skill 来源各有取舍。按可信度、更新频率、定价和适用场景，讲清楚什么时候该用哪一类。",
      en: "Five kinds of skill sources, each with trade-offs. When to use which, by trust, freshness, pricing, and use case."
    }
  }
];

export function getGuides(): Guide[] {
  return guides;
}


export function getGuideBySlug(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}
