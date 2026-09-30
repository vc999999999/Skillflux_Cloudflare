import { buildIndexPayload } from "../lib/content";
import { discoveryIndex } from "../lib/discovery";

export const prerender = true;

export function GET() {
  return new Response(JSON.stringify({ ...buildIndexPayload(), ...discoveryIndex() }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
