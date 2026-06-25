import { nowIso, runMigrations } from "./db.js";
import { randomId } from "./crypto.js";
import type { AuthContext } from "./catalog.js";
import { tiersForPlan } from "./entitlement.js";

export interface EntitlementRow {
  id: string;
  user_id: string;
  product: string;
  plan: string;
  status: string;
  source: string;
  order_id: string | null;
  created_at: string;
  expires_at: string | null;
}

export async function ensureDb(db: D1Database): Promise<void> {
  await runMigrations(db);
}

export async function getActiveEntitlement(
  db: D1Database,
  userId: string,
  product: string,
): Promise<EntitlementRow | null> {
  return db
    .prepare(
      `SELECT * FROM entitlements
       WHERE user_id = ? AND product = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, product)
    .first<EntitlementRow>();
}

export async function grantEntitlement(
  db: D1Database,
  input: {
    userId: string;
    product: string;
    plan: string;
    source: string;
    orderId?: string;
    expiresAt?: string | null;
  },
): Promise<EntitlementRow> {
  const id = randomId("ent_");
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO entitlements (id, user_id, product, plan, status, source, order_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.product,
      input.plan,
      input.source,
      input.orderId ?? null,
      createdAt,
      input.expiresAt ?? null,
    )
    .run();

  return {
    id,
    user_id: input.userId,
    product: input.product,
    plan: input.plan,
    status: "active",
    source: input.source,
    order_id: input.orderId ?? null,
    created_at: createdAt,
    expires_at: input.expiresAt ?? null,
  };
}

export function authContextFromEntitlement(
  userId: string,
  entitlement: EntitlementRow | null,
): AuthContext {
  if (!entitlement) {
    return { userId, plan: "free", tiers: tiersForPlan("free") };
  }
  const plan = entitlement.plan as AuthContext["plan"];
  return { userId, plan, tiers: tiersForPlan(plan) };
}

export function hasDeluxeAccess(auth: AuthContext): boolean {
  return auth.tiers.includes("deluxe");
}
