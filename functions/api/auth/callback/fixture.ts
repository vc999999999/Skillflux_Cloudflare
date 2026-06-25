import { grantEntitlement } from "../../../lib/entitlements-db.js";
import { bindUserToSession, getDeviceSessionById, sessionExpired, markSessionExpired } from "../../../lib/sessions.js";
import { upsertFixtureUser } from "../../../lib/users.js";
import { siteUrl } from "../../../lib/oauth-github.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  if (context.env.SKILLFLUX_FIXTURE_MODE !== "1") {
    return new Response("Fixture auth disabled.", { status: 404 });
  }

  const sessionId = new URL(context.request.url).searchParams.get("session");
  if (!sessionId) {
    return new Response("Missing session.", { status: 400 });
  }

  const session = await getDeviceSessionById(context.env.DB, sessionId);
  if (!session) {
    return new Response("Unknown session.", { status: 404 });
  }
  if (sessionExpired(session)) {
    await markSessionExpired(context.env.DB, session.id);
    return new Response("Session expired.", { status: 410 });
  }

  const user = await upsertFixtureUser(context.env.DB);
  await bindUserToSession(context.env.DB, session.id, user.id);

  const product = context.env.SKILLFLUX_PRODUCT ?? "deluxe-pack";
  const grantFixture = new URL(context.request.url).searchParams.get("purchase") === "1";
  if (grantFixture) {
    await grantEntitlement(context.env.DB, {
      userId: user.id,
      product,
      plan: "lifetime",
      source: "fixture",
      orderId: "fixture-order",
    });
  }

  const origin = siteUrl(context.env, context.request);
  return Response.redirect(`${origin}/device?done=1`, 302);
};
