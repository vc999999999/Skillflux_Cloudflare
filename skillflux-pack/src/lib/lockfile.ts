import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { ensureProjectSkillfluxDir, projectLockfilePath } from "./project.js";
import type { InstallScope } from "./paths.js";

export interface InstalledSkillRecord {
  version: string;
  scope: InstallScope;
  path: string;
  sha256: string;
  files: string[];
}

export interface InstalledLockfile {
  skills: Record<string, InstalledSkillRecord>;
}

export async function readLockfile(cwd = process.cwd()): Promise<InstalledLockfile> {
  try {
    const raw = await readFile(projectLockfilePath(cwd), "utf8");
    return JSON.parse(raw) as InstalledLockfile;
  } catch (error) {
    if (isENOENT(error)) {
      return { skills: {} };
    }
    throw error;
  }
}

export async function writeLockfile(
  lockfile: InstalledLockfile,
  cwd = process.cwd(),
): Promise<void> {
  await ensureProjectSkillfluxDir(cwd);
  await writeFile(projectLockfilePath(cwd), `${JSON.stringify(lockfile, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(projectLockfilePath(cwd), 0o600);
}

export async function upsertInstalledSkill(
  id: string,
  record: InstalledSkillRecord,
  cwd = process.cwd(),
): Promise<InstalledLockfile> {
  const lockfile = await readLockfile(cwd);
  lockfile.skills[id] = record;
  await writeLockfile(lockfile, cwd);
  return lockfile;
}

export async function removeInstalledSkill(
  id: string,
  cwd = process.cwd(),
): Promise<InstalledLockfile> {
  const lockfile = await readLockfile(cwd);
  delete lockfile.skills[id];
  await writeLockfile(lockfile, cwd);
  return lockfile;
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
