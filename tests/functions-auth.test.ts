import { describe, expect, it } from "vitest";
import { authContextFromEntitlement, hasDeluxeAccess } from "../functions/lib/entitlements-db";
import { tiersForPlan } from "../functions/lib/entitlement";

describe("auth entitlement context", () => {
  it("free user without entitlement gets needs_payment path", () => {
    const auth = authContextFromEntitlement("user-1", null);
    expect(auth.plan).toBe("free");
    expect(hasDeluxeAccess(auth)).toBe(false);
    expect(tiersForPlan(auth.plan)).toEqual(["free"]);
  });

  it("lifetime entitlement unlocks deluxe", () => {
    const auth = authContextFromEntitlement("user-1", {
      id: "ent_1",
      user_id: "user-1",
      product: "deluxe-pack",
      plan: "lifetime",
      status: "active",
      source: "stripe",
      order_id: "ord_1",
      created_at: new Date().toISOString(),
      expires_at: null,
    });
    expect(hasDeluxeAccess(auth)).toBe(true);
    expect(tiersForPlan(auth.plan)).toContain("deluxe");
  });
});
