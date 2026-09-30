import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

// Skill 拆解专题。schema 即选品门槛:场景、流程、判断、痛点、局限都有
// 最小数量要求——拆不出这些増量槽位的 skill 不应该成文。
// 管线约定见 docs/insights-pipeline.md。
const insights = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/insights" }),
  schema: z.object({
    title: z.string().min(8),
    description: z.string().min(20),
    datePublished: z.string().regex(datePattern, "use YYYY-MM-DD"),
    dateModified: z.string().regex(datePattern, "use YYYY-MM-DD"),
    // 该 skill 所属的行业/领域,如「内容创作 / 编辑插画」
    industry: z.string().min(2),
    skillName: z.string().min(2),
    // 署名三件套缺一不可:拆解别人的作品必须给出处、作者和协议。
    source: z.object({
      repo: z.url(),
      author: z.string().min(1),
      authorUrl: z.url().optional(),
      license: z.string().min(2)
    }),
    tags: z.array(z.string().min(1)).min(1),
    // 内链到 data/sites.json 里的收录站 slug
    relatedSites: z.array(z.string()).default([]),
    // 给 AI 的一句话摘要,会进入 llms.txt / RSS
    tldr: z.string().min(20),
    scenarios: z.array(z.string().min(2)).min(2),
    // 编码的经验流程:skill 内部真实的工作步骤
    workflow: z.array(z.object({ step: z.string().min(2), detail: z.string().min(8) })).min(3),
    // 编码的专家判断:这个 skill 的「精华」,别处抄不到的取舍
    judgments: z.array(z.string().min(8)).min(3),
    // 行业痛点 → skill 的解法
    painPoints: z.array(z.object({ pain: z.string().min(4), solution: z.string().min(4) })).min(2),
    limitations: z.array(z.string().min(4)).min(2),
    draft: z.boolean().default(false)
  })
});

export const collections = { insights };
