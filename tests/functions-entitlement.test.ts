import { describe, expect, it } from "vitest";
import { canAccessSkill, tiersForPlan } from "../functions/lib/entitlement";

describe("registry entitlement", () => {
  it("lifetime plan includes deluxe tier", () => {
    expect(tiersForPlan("lifetime")).toContain("deluxe");
    expect(
      canAccessSkill({ userId: "u1", plan: "lifetime", tiers: ["free", "deluxe"] }, "deluxe"),
    ).toBe(true);
  });

  it("free plan excludes deluxe tier", () => {
    expect(
      canAccessSkill({ userId: "u1", plan: "free", tiers: ["free"] }, "deluxe"),
    ).toBe(false);
  });
});
