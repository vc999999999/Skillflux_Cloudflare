import { getCatalog, getSkillPayload } from "../../lib/catalog.js";
import { authenticate, forbidden, hasDeluxeAccess, json, notFound } from "../../lib/auth.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await authenticate(context.request, context.env);
  if (auth instanceof Response) return auth;

  const id = context.params.id as string;
  const version = context.request.url
    ? new URL(context.request.url).searchParams.get("version")
    : null;

  const catalog = getCatalog();
  const meta = catalog.manifest.skills.find((skill) => skill.id === id);
  if (!meta) {
    return notFound(`Skill not found: ${id}`);
  }

  if (meta.tier === "deluxe" && !hasDeluxeAccess(auth)) {
    return forbidden(`Your plan does not include deluxe skill '${id}'. Complete checkout first.`);
  }

  const payload = getSkillPayload(id, version);
  if (!payload) {
    return notFound(
      version
        ? `Skill ${id} version ${version} not found.`
        : `Skill payload missing for ${id}.`,
    );
  }

  return json({
    ok: true,
    message: `Skill payload for ${id}@${payload.version}.`,
    data: payload,
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
