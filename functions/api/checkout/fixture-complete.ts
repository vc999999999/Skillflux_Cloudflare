import { grantEntitlement } from "../../lib/entitlements-db.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  if (context.env.SKILLFLUX_FIXTURE_MODE !== "1") {
    return new Response("Not found", { status: 404 });
  }

  const userId = new URL(context.request.url).searchParams.get("user");
  if (!userId) {
    return new Response("Missing user.", { status: 400 });
  }

  const product = context.env.SKILLFLUX_PRODUCT ?? "deluxe-pack";
  await grantEntitlement(context.env.DB, {
    userId,
    product,
    plan: "lifetime",
    source: "fixture",
    orderId: `fixture-${Date.now()}`,
  });

  return new Response(
    `<!doctype html><html><body><h1>SkillFlux fixture checkout complete</h1><p>You can return to your agent and run auth.status again.</p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
};
