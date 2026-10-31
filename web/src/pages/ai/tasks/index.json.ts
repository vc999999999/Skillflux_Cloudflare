import { aiTaskIndex } from "../../../lib/ai-layer";

export const prerender = true;

export function GET() {
  return new Response(`${JSON.stringify(aiTaskIndex(), null, 2)}\n`, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
