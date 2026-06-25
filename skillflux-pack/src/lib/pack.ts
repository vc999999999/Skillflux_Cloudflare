import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bundledPackPath, bundledSkillsDir } from "./paths.js";
import { hashFileMap } from "./fs-utils.js";

export type SkillOrigin = "rewrite" | "original";

export interface PackSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  origin: SkillOrigin;
  path: string;
  tier: string;
  sha256: string;
}

export interface PackManifest {
  name: string;
  packVersion: string;
  updatedAt: string;
  agents: string[];
  skills: PackSkill[];
}

export interface SkillFilePayload {
  id: string;
  version: string;
  sha256: string;
  files: Record<string, string>;
}

export function computePayloadHash(files: Record<string, string>): string {
  return hashFileMap(files);
}

export function verifySkillPayload(payload: SkillFilePayload): void {
  const computed = computePayloadHash(payload.files);
  if (computed !== payload.sha256) {
    throw new Error(
      `Skill payload checksum mismatch for ${payload.id}: expected ${payload.sha256}, got ${computed}`,
    );
  }
}

export async function loadPackManifest(): Promise<PackManifest> {
  const raw = await readFile(bundledPackPath(), "utf8");
  return JSON.parse(raw) as PackManifest;
}

async function readSkillFiles(skillRoot: string, currentDir = ""): Promise<Record<string, string>> {
  const absoluteDir = currentDir ? join(skillRoot, currentDir) : skillRoot;
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: Record<string, string> = {};

  for (const entry of entries) {
    const relativePath = currentDir ? `${currentDir}/${entry.name}` : entry.name;
    const absolutePath = join(skillRoot, relativePath);
    if (entry.isDirectory()) {
      Object.assign(files, await readSkillFiles(skillRoot, relativePath));
    } else if (entry.isFile()) {
      files[relativePath.split("\\").join("/")] = await readFile(absolutePath, "utf8");
    }
  }

  return files;
}

export async function loadBundledSkill(id: string, version?: string): Promise<SkillFilePayload> {
  const manifest = await loadPackManifest();
  const skill = manifest.skills.find((entry) => entry.id === id);
  if (!skill) {
    throw new Error(`Skill not found in pack: ${id}`);
  }
  if (version && version !== skill.version) {
    throw new Error(`Requested version ${version} does not match bundled ${skill.version}`);
  }

  const skillRoot = join(bundledSkillsDir(), id);
  const files = await readSkillFiles(skillRoot);

  if (!files["SKILL.md"]) {
    throw new Error(`Bundled skill missing SKILL.md: ${id}`);
  }

  const contentHash = computePayloadHash(files);
  if (skill.sha256 !== contentHash) {
    throw new Error(
      `Bundled skill checksum mismatch for ${id}. Run pack sync to refresh sha256.`,
    );
  }

  return {
    id: skill.id,
    version: skill.version,
    sha256: contentHash,
    files,
  };
}

export function filterPackSkills(
  manifest: PackManifest,
  query?: string,
  category?: string,
): PackSkill[] {
  return manifest.skills.filter((skill) => {
    if (category && skill.category !== category) return false;
    if (!query?.trim()) return true;
    const needle = query.trim().toLowerCase();
    return (
      skill.id.includes(needle) ||
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle)
    );
  });
}
