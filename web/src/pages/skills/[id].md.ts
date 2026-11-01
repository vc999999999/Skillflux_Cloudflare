import type { APIRoute } from "astro";
import { skillMarkdown } from "../../lib/ai-layer";
import { getIndexableSkillViews } from "../../lib/skills";
import type { SkillView } from "../../lib/skill-data";

export const prerender = true;

export function getStaticPaths() {
  return getIndexableSkillViews().map(view => ({ params: { id: view.skill.id }, props: { view } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(skillMarkdown((props as { view: SkillView }).view), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
