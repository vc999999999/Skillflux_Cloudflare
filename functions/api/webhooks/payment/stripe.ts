import { grantEntitlement } from "../../../lib/entitlements-db.js";
import { nowIso, runMigrations } from "../../../lib/db.js";
import { verifyStripeSignature } from "../../../lib/stripe.js";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const secret = context.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Stripe webhook secret not configured.", { status: 501 });
  }

  const payload = await context.request.text();
  const signature = context.request.headers.get("Stripe-Signature");
  const valid = await verifyStripeSignature(payload, signature, secret);
  if (!valid) {
    return new Response("Invalid signature.", { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
  };

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data.object;
  const userId = String(session.client_reference_id ?? session.metadata?.user_id ?? "");
  const product = String(session.metadata?.product ?? context.env.SKILLFLUX_PRODUCT ?? "deluxe-pack");
  const checkoutId = String(session.metadata?.checkout_id ?? "");
  const providerRef = String(session.id ?? "");

  if (!userId) {
    return new Response("Missing user reference.", { status: 400 });
  }

  await runMigrations(context.env.DB);
  await grantEntitlement(context.env.DB, {
    userId,
    product,
    plan: "lifetime",
    source: "stripe",
    orderId: providerRef,
  });

  if (checkoutId) {
    await context.env.DB.prepare(
      `UPDATE checkout_sessions SET status = 'completed', completed_at = ?, provider_ref = ? WHERE id = ?`,
    )
      .bind(nowIso(), providerRef, checkoutId)
      .run();
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
