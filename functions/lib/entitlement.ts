import type { AuthContext } from "./catalog";

export function tiersForPlan(plan: AuthContext["plan"]): string[] {
  switch (plan) {
    case "fixture":
    case "lifetime":
    case "annual":
    case "monthly":
      return ["free", "deluxe"];
    case "free":
      return ["free"];
    default:
      return ["free"];
  }
}

export function canAccessSkill(auth: AuthContext, tier: string): boolean {
  return tiersForPlan(auth.plan).includes(tier);
}

export function publicTiers(): string[] {
  return ["free"];
}
