import type { APIRoute } from "astro";
import { aiTasks, type TaskDoc } from "../../../lib/ai-layer";

export const prerender = true;

export function getStaticPaths() {
  return aiTasks().map(doc => ({ params: { task: doc.task }, props: { doc } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(`${JSON.stringify((props as { doc: TaskDoc }).doc, null, 2)}\n`, { headers: { "Content-Type": "application/json; charset=utf-8" } });
