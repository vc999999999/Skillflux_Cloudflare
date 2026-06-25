import { authenticate, json, parseBearerToken } from "../lib/auth.js";
import { createStripeCheckout } from "../lib/stripe.js";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const token = parseBearerToken(context.request);
  if (!token) {
    return json({ ok: false, code: "UNAUTHORIZED", message: "Bearer token required." }, 401);
  }

  const auth = await authenticate(context.request, context.env);
  if (auth instanceof Response) return auth;

  let body: { product?: string } = {};
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    body = {};
  }

  const product = body.product ?? context.env.SKILLFLUX_PRODUCT ?? "deluxe-pack";

  try {
    if (context.env.STRIPE_SECRET_KEY && context.env.STRIPE_PRICE_ID) {
      const checkout = await createStripeCheckout(context.env, context.request, auth.userId, product);
      return json({
        ok: true,
        message: "Stripe checkout session created.",
        data: { checkoutUrl: checkout.checkoutUrl },
      });
    }
  } catch (error) {
    return json(
      {
        ok: false,
        code: "CHECKOUT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }

  if (context.env.SKILLFLUX_FIXTURE_MODE === "1") {
    const origin = new URL(context.request.url).origin;
    return json({
      ok: true,
      message: "Fixture checkout URL (complete in browser to grant entitlement).",
      data: {
        checkoutUrl: `${origin}/api/checkout/fixture-complete?user=${encodeURIComponent(auth.userId)}`,
      },
    });
  }

  return json(
    {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "No hosted checkout provider configured.",
    },
    501,
  );
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
