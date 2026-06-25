import { json } from "../../lib/auth.js";
import { sha256Hex } from "../../lib/crypto.js";
import { siteUrl } from "../../lib/oauth-github.js";
import { createDeviceSession } from "../../lib/sessions.js";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { deviceId?: string; agent?: string } = {};
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return json({ ok: false, code: "INVALID_INPUT", message: "Invalid JSON body." }, 400);
  }

  if (!body.deviceId || !body.agent) {
    return json(
      { ok: false, code: "INVALID_INPUT", message: "deviceId and agent are required." },
      400,
    );
  }

  const deviceIdHash = await sha256Hex(body.deviceId);
  const session = await createDeviceSession(context.env.DB, deviceIdHash, body.agent);
  const origin = siteUrl(context.env, context.request);
  const loginUrl = `${origin}/device?session=${encodeURIComponent(session.id)}&code=${encodeURIComponent(session.user_code)}`;

  return json({
    ok: true,
    message: "Device session created. Open loginUrl in your browser.",
    data: {
      loginUrl,
      deviceSessionId: session.id,
      userCode: session.user_code,
      expiresAt: session.expires_at,
      pollAfterSeconds: 2,
    },
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
