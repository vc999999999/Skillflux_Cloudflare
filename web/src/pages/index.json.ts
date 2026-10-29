import { buildIndexPayload } from "../lib/content";
import { dataDiscoveryIndex } from "../lib/data-discovery";
import { discoveryIndex } from "../lib/discovery";

export const prerender = true;

export function GET() {
  return new Response(JSON.stringify({ ...buildIndexPayload(), ...dataDiscoveryIndex(), ...discoveryIndex() }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
