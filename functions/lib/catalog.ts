import catalogJson from "../_pack/catalog.json";

export interface PackSkillEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  origin: string;
  path: string;
  tier: string;
  sha256: string;
}

export interface PackManifest {
  name: string;
  packVersion: string;
  updatedAt: string;
  agents: string[];
  skills: PackSkillEntry[];
}

export interface SkillPayload {
  id: string;
  version: string;
  sha256: string;
  files: Record<string, string>;
}

export interface PackCatalog {
  manifest: PackManifest;
  skills: Record<string, SkillPayload>;
  generatedAt: string;
}

export interface AuthContext {
  userId: string;
  plan: "free" | "lifetime" | "annual" | "monthly" | "fixture";
  tiers: string[];
}

export function getCatalog(): PackCatalog {
  return catalogJson as PackCatalog;
}

export function getSkillPayload(id: string, version?: string | null): SkillPayload | null {
  const catalog = getCatalog();
  const payload = catalog.skills[id];
  if (!payload) return null;
  if (version && version !== payload.version) return null;
  return payload;
}

export function filterManifestByTiers(
  manifest: PackManifest,
  allowedTiers: Set<string>,
): PackManifest {
  return {
    ...manifest,
    skills: manifest.skills.filter((skill) => allowedTiers.has(skill.tier)),
  };
}
