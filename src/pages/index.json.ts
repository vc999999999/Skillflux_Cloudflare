import { buildIndexPayload } from "../lib/content";

export const prerender = true;

export function GET() {
  return new Response(JSON.stringify(buildIndexPayload(), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
