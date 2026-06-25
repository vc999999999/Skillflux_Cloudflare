import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export const SKILLFLUX_SCHEMA_VERSION = "2026-06-25";
export const PROJECT_DIR = ".skillflux";
export const PROJECT_SKILLS_DIR = join(PROJECT_DIR, "skills");
export const PROJECT_MANIFEST = "skillflux.json";
export const PROJECT_LOCKFILE = join(PROJECT_DIR, "installed.json");

export function getProjectRoot(cwd = process.cwd()): string {
  return resolve(cwd);
}

export function projectManifestPath(cwd = process.cwd()): string {
  return join(getProjectRoot(cwd), PROJECT_MANIFEST);
}

export function projectLockfilePath(cwd = process.cwd()): string {
  return join(getProjectRoot(cwd), PROJECT_LOCKFILE);
}

export function projectSkillDir(id: string, cwd = process.cwd()): string {
  return join(getProjectRoot(cwd), PROJECT_SKILLS_DIR, id);
}

export function projectSkillfluxDir(cwd = process.cwd()): string {
  return join(getProjectRoot(cwd), PROJECT_DIR);
}

export function toProjectRelativePath(absolutePath: string, cwd = process.cwd()): string {
  const rel = relative(getProjectRoot(cwd), resolve(absolutePath));
  if (rel.startsWith("..")) {
    throw new Error(`Path escapes project root: ${absolutePath}`);
  }
  return rel.split("\\").join("/");
}

export async function ensureProjectSkillfluxDir(cwd = process.cwd()): Promise<void> {
  await mkdir(projectSkillfluxDir(cwd), { recursive: true });
}
