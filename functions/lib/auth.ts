import type { AuthContext } from "./catalog";
import { sha256Hex } from "./crypto.js";
import {
  authContextFromEntitlement,
  ensureDb,
  getActiveEntitlement,
  hasDeluxeAccess,
} from "./entitlements-db.js";
import { checkRateLimit } from "./rate-limit.js";
import {
  getDeviceByTokenHash,
  getDeviceSessionById,
  issueDeviceForSession,
  markSessionExpired,
  sessionExpired,
  touchDevice,
} from "./sessions.js";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ ok: false, code, message, ...extra }, status);
}

export function unauthorized(message = "Bearer token required"): Response {
  return errorResponse(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Insufficient entitlement"): Response {
  return errorResponse(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found"): Response {
  return errorResponse(404, "NOT_FOUND", message);
}

export function tooManyRequests(message = "Rate limit exceeded"): Response {
  return errorResponse(429, "RATE_LIMITED", message);
}

export function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function productId(env: Env): string {
  return env.SKILLFLUX_PRODUCT ?? "deluxe-pack";
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext | Response> {
  const token = parseBearerToken(request);
  if (!token) {
    return unauthorized();
  }

  if (!(await checkRateLimit(env.DB, `auth:${token.slice(0, 12)}`))) {
    return tooManyRequests();
  }

  if (env.SKILLFLUX_API_DEV_TOKEN && token === env.SKILLFLUX_API_DEV_TOKEN) {
    return { userId: "dev-user", plan: "lifetime", tiers: ["free", "deluxe"] };
  }

  if (env.SKILLFLUX_FIXTURE_MODE === "1" && (token === "fixture-dev-token" || token.startsWith("sfx_fixture_"))) {
    return { userId: "fixture-user", plan: "lifetime", tiers: ["free", "deluxe"] };
  }

  await ensureDb(env.DB);
  const tokenHash = await sha256Hex(token);
  const device = await getDeviceByTokenHash(env.DB, tokenHash);
  if (!device) {
    return unauthorized("Invalid or expired device token.");
  }

  await touchDevice(env.DB, device.id);
  const entitlement = await getActiveEntitlement(env.DB, device.user_id, productId(env));
  return authContextFromEntitlement(device.user_id, entitlement);
}

export async function resolveDeviceStatus(
  env: Env,
  input: { deviceSessionId?: string; bearerToken?: string | null },
): Promise<{
  status: "unauthenticated" | "pending" | "needs_payment" | "active" | "expired";
  plan?: string;
  deviceToken?: string;
  pollAfterSeconds?: number;
  message?: string;
}> {
  await ensureDb(env.DB);

  if (input.bearerToken) {
    const tokenHash = await sha256Hex(input.bearerToken);
    const device = await getDeviceByTokenHash(env.DB, tokenHash);
    if (!device) {
      return { status: "unauthenticated", message: "Invalid device token." };
    }
    const entitlement = await getActiveEntitlement(env.DB, device.user_id, productId(env));
    const auth = authContextFromEntitlement(device.user_id, entitlement);
    if (!hasDeluxeAccess(auth)) {
      return {
        status: "needs_payment",
        plan: auth.plan,
        message: "Login succeeded. Purchase required for deluxe skills.",
      };
    }
    return { status: "active", plan: auth.plan, message: "Device authorized." };
  }

  if (env.SKILLFLUX_FIXTURE_MODE === "1" && input.deviceSessionId) {
    const fixture = authFromFixtureSession(input.deviceSessionId);
    if (fixture) {
      return {
        status: "active",
        plan: fixture.plan,
        deviceToken: "fixture-dev-token",
        message: "Fixture device authorized.",
      };
    }
  }

  if (!input.deviceSessionId) {
    return { status: "unauthenticated", message: "No device session." };
  }

  const session = await getDeviceSessionById(env.DB, input.deviceSessionId);
  if (!session) {
    return { status: "unauthenticated", message: "Unknown device session." };
  }

  if (sessionExpired(session)) {
    await markSessionExpired(env.DB, session.id);
    return { status: "expired", message: "Device session expired. Start auth again." };
  }

  if (session.status === "pending" || !session.user_id) {
    return {
      status: "pending",
      pollAfterSeconds: 2,
      message: "Waiting for browser login.",
    };
  }

  const entitlement = await getActiveEntitlement(env.DB, session.user_id, productId(env));
  const auth = authContextFromEntitlement(session.user_id, entitlement);
  const issued = await issueDeviceForSession(env.DB, session);

  if (!hasDeluxeAccess(auth)) {
    return {
      status: "needs_payment",
      plan: auth.plan,
      deviceToken: issued.token,
      message: "Login succeeded. Complete checkout to unlock deluxe skills.",
    };
  }

  return {
    status: "active",
    plan: auth.plan,
    deviceToken: issued.token,
    message: "Device authorized.",
  };
}

export function authFromFixtureSession(deviceSessionId?: string): AuthContext | null {
  if (!deviceSessionId) return null;
  if (deviceSessionId === "fixture-session" || deviceSessionId.startsWith("fixture-")) {
    return { userId: "fixture-user", plan: "lifetime", tiers: ["free", "deluxe"] };
  }
  return null;
}

export { hasDeluxeAccess };
