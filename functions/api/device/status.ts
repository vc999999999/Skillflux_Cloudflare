import { json, parseBearerToken, resolveDeviceStatus } from "../../lib/auth.js";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { deviceSessionId?: string } = {};
  try {
    if (context.request.headers.get("Content-Type")?.includes("application/json")) {
      body = (await context.request.json()) as typeof body;
    }
  } catch {
    return json({ ok: false, code: "INVALID_INPUT", message: "Invalid JSON body." }, 400);
  }

  const bearer = parseBearerToken(context.request);
  const status = await resolveDeviceStatus(context.env, {
    deviceSessionId: body.deviceSessionId,
    bearerToken: bearer,
  });

  return json({
    ok: true,
    message: status.message ?? `Auth status: ${status.status}.`,
    data: status,
  });
};

export const onRequestGet: PagesFunction<Env> = async (context) => onRequestPost(context);

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
