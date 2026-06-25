import { filterManifestByTiers, getCatalog } from "../lib/catalog.js";
import { authenticate, hasDeluxeAccess, json } from "../lib/auth.js";
import { publicTiers, tiersForPlan } from "../lib/entitlement.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const catalog = getCatalog();
  const token = context.request.headers.get("Authorization");

  if (!token) {
    const manifest = filterManifestByTiers(catalog.manifest, new Set(publicTiers()));
    return json({
      ok: true,
      message: "Public catalog metadata (free tier only).",
      data: manifest,
    });
  }

  const auth = await authenticate(context.request, context.env);
  if (auth instanceof Response) return auth;

  const manifest = filterManifestByTiers(
    catalog.manifest,
    new Set(tiersForPlan(auth.plan)),
  );

  return json({
    ok: true,
    message: hasDeluxeAccess(auth)
      ? "Authorized catalog metadata."
      : "Authorized catalog metadata (free tier; deluxe requires purchase).",
    data: manifest,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
