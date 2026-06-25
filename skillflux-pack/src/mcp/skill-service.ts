import { join } from "node:path";
import { rm } from "node:fs/promises";
import { isFixtureMode, readConfig } from "../lib/config.js";
import { hashFileMap, toRelativePaths, writeFilesAtomically } from "../lib/fs-utils.js";
import { readLockfile, removeInstalledSkill, upsertInstalledSkill } from "../lib/lockfile.js";
import { readProjectManifest, removeProjectSkill, upsertProjectSkill } from "../lib/manifest.js";
import {
  filterPackSkills,
  loadBundledSkill,
  loadPackManifest,
  verifySkillPayload,
  type PackManifest,
  type PackSkill,
  type SkillFilePayload,
} from "../lib/pack.js";
import type { InstallScope } from "../lib/paths.js";
import {
  PROJECT_SKILLS_DIR,
  getProjectRoot,
  projectSkillDir,
  toProjectRelativePath,
} from "../lib/project.js";
import { fetchPack, fetchSkill, resolveAuthStatus } from "./api-client.js";
import { readInstalledSkillFiles } from "./doctor-service.js";
import {
  SkillFluxError,
  authError,
  okResult,
  type ToolResult,
} from "./tool-response.js";

interface InstallSkillData {
  id: string;
  version: string;
  scope: InstallScope;
  path: string;
  manifestPath: string;
  lockfilePath: string;
  files: string[];
}

function resolveScope(scope?: InstallScope): InstallScope {
  return scope ?? "project";
}

async function requireCatalogAuth(): Promise<void> {
  const auth = await resolveAuthStatus();
  if (
    auth.status === "unauthenticated" ||
    auth.status === "pending" ||
    auth.status === "expired"
  ) {
    throw authError(auth.status, auth.message ?? `Authorization required (${auth.status}).`);
  }
}

async function requireSkillAuth(tier: string): Promise<void> {
  const auth = await resolveAuthStatus();
  if (
    auth.status === "unauthenticated" ||
    auth.status === "pending" ||
    auth.status === "expired"
  ) {
    throw authError(auth.status, auth.message ?? `Authorization required (${auth.status}).`);
  }
  if (tier === "deluxe" && auth.status === "needs_payment") {
    throw authError(
      auth.status,
      auth.message ?? "Deluxe skills require purchase. Call billing.checkout first.",
    );
  }
}

async function resolveSkillTier(id: string): Promise<string> {
  const manifest = await loadManifest();
  const skill = manifest.skills.find((entry) => entry.id === id);
  if (!skill) {
    throw new SkillFluxError("NOT_FOUND", `Skill not found in catalog: ${id}`);
  }
  return skill.tier;
}

async function loadSkillPayload(id: string, version?: string): Promise<SkillFilePayload> {
  const config = await readConfig();
  if (isFixtureMode()) {
    return loadBundledSkill(id, version);
  }

  if (!config?.deviceToken) {
    throw new SkillFluxError("AUTH_REQUIRED", "Missing device token.", { tool: "auth.start" });
  }

  const payload = await fetchSkill(config.deviceToken, id, version);
  return payload as SkillFilePayload;
}

async function loadManifest(): Promise<PackManifest> {
  const config = await readConfig();
  if (isFixtureMode()) {
    return loadPackManifest();
  }
  if (!config?.deviceToken) {
    throw new SkillFluxError("AUTH_REQUIRED", "Missing device token.", { tool: "auth.start" });
  }
  const manifest = await fetchPack(config.deviceToken);
  return manifest as PackManifest;
}

function computeInstalledHash(
  projectRoot: string,
  installed: { path: string; files: string[] },
): Promise<string> {
  return readInstalledSkillFiles(projectRoot, installed.path, installed.files).then(hashFileMap);
}

export async function installSkill(
  id: string,
  scope?: InstallScope,
  cwd = process.cwd(),
): Promise<ToolResult<InstallSkillData>> {
  await requireSkillAuth(await resolveSkillTier(id));

  const payload = await loadSkillPayload(id);
  verifySkillPayload(payload);

  const installScope = resolveScope(scope);
  const projectRoot = getProjectRoot(cwd);
  const targetDir = projectSkillDir(id, cwd);
  const relativeSkillPath = join(PROJECT_SKILLS_DIR, id).split("\\").join("/");

  const written = await writeFilesAtomically(targetDir, payload.files);
  const relativeFiles = toRelativePaths(targetDir, written);

  await upsertInstalledSkill(
    id,
    {
      version: payload.version,
      scope: installScope,
      path: relativeSkillPath,
      sha256: payload.sha256,
      files: relativeFiles,
    },
    cwd,
  );
  await upsertProjectSkill(id, payload.version, cwd);

  return okResult(
    {
      id,
      version: payload.version,
      scope: installScope,
      path: toProjectRelativePath(targetDir, cwd),
      manifestPath: toProjectRelativePath(join(projectRoot, "skillflux.json"), cwd),
      lockfilePath: toProjectRelativePath(join(projectRoot, ".skillflux", "installed.json"), cwd),
      files: relativeFiles,
    },
    `Installed ${id}@${payload.version} into ${relativeSkillPath}.`,
    "installed",
  );
}

export async function updateSkills(
  id?: string,
  force = false,
  cwd = process.cwd(),
): Promise<ToolResult> {
  await requireCatalogAuth();

  const manifest = await loadManifest();
  const lockfile = await readLockfile(cwd);
  const projectRoot = getProjectRoot(cwd);
  const targets = id ? [id] : Object.keys(lockfile.skills);

  const updates: Array<{ id: string; from?: string; to: string; path: string }> = [];
  const conflicts: Array<{ id: string; message: string }> = [];

  for (const skillId of targets) {
    const installed = lockfile.skills[skillId];
    if (!installed) continue;

    const remote = manifest.skills.find((skill) => skill.id === skillId);
    if (!remote) continue;
    if (installed.version === remote.version) continue;

    const localHash = await computeInstalledHash(projectRoot, installed);
    if (localHash !== installed.sha256 && !force) {
      conflicts.push({
        id: skillId,
        message: "Local files were modified since install. Re-run skill.update with force=true to overwrite.",
      });
      continue;
    }

    const result = await installSkill(skillId, installed.scope, cwd);
    if (!result.ok) return result;

    updates.push({
      id: skillId,
      from: installed.version,
      to: result.data.version,
      path: result.data.path,
    });
  }

  if (conflicts.length > 0 && updates.length === 0) {
    throw new SkillFluxError(
      "CONFLICT",
      "One or more skills have local modifications.",
    );
  }

  return okResult(
    { updated: updates, conflicts },
    updates.length
      ? `Updated ${updates.length} skill(s).`
      : conflicts.length
        ? "Updates skipped due to local modifications."
        : "All project skills are up to date.",
    conflicts.length ? "conflict" : "updated",
  );
}

export async function listInstalledSkills(cwd = process.cwd()): Promise<ToolResult> {
  await requireCatalogAuth();

  const manifest = await loadManifest();
  const lockfile = await readLockfile(cwd);

  const skills = Object.entries(lockfile.skills).map(([skillId, installed]) => {
    const remote = manifest.skills.find((skill) => skill.id === skillId);
    return {
      id: skillId,
      installedVersion: installed.version,
      latestVersion: remote?.version,
      updateAvailable: remote ? remote.version !== installed.version : false,
      path: installed.path,
      scope: installed.scope,
    };
  });

  return okResult(
    { projectRoot: getProjectRoot(cwd), skills },
    skills.length
      ? `This project has ${skills.length} enabled SkillFlux skill(s).`
      : "No SkillFlux skills enabled in this project yet.",
    "listed",
  );
}

export async function searchPack(
  query?: string,
  category?: string,
  cwd = process.cwd(),
): Promise<ToolResult> {
  await requireCatalogAuth();

  const manifest = await loadManifest();
  const lockfile = await readLockfile(cwd);
  const skills = filterPackSkills(manifest, query, category).map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    tier: skill.tier,
    installed: Boolean(lockfile.skills[skill.id]),
    installedVersion: lockfile.skills[skill.id]?.version,
  }));

  return okResult(
    { query, category, skills },
    skills.length
      ? `Found ${skills.length} matching skill(s) in the SkillFlux catalog.`
      : "No skills matched your search.",
    "searched",
  );
}

export async function getPackSkillInfo(id: string, cwd = process.cwd()): Promise<ToolResult> {
  await requireCatalogAuth();

  const manifest = await loadManifest();
  const skill = manifest.skills.find((entry) => entry.id === id);
  if (!skill) {
    throw new SkillFluxError("NOT_FOUND", `Skill not found in catalog: ${id}`);
  }

  const lockfile = await readLockfile(cwd);
  const installed = lockfile.skills[id];

  return okResult(
    formatSkillInfo(skill, installed),
    `Catalog details for ${id}.`,
    "info",
  );
}

function formatSkillInfo(
  skill: PackSkill,
  installed?: { version: string; path: string; scope: InstallScope },
) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    tier: skill.tier,
    origin: skill.origin,
    installed: Boolean(installed),
    installedVersion: installed?.version,
    installedPath: installed?.path,
    installedScope: installed?.scope,
  };
}

export async function removeSkill(id: string, cwd = process.cwd()): Promise<ToolResult> {
  const lockfile = await readLockfile(cwd);
  const installed = lockfile.skills[id];
  if (!installed) {
    throw new SkillFluxError("NOT_INSTALLED", `Skill not installed in this project: ${id}`);
  }

  const projectRoot = getProjectRoot(cwd);
  const { removeTrackedFiles } = await import("../lib/fs-utils.js");
  await removeTrackedFiles(join(projectRoot, installed.path), installed.files);
  await rm(join(projectRoot, installed.path), { recursive: true, force: true });
  await removeInstalledSkill(id, cwd);
  await removeProjectSkill(id, cwd);

  return okResult(
    { id, removed: true, path: installed.path },
    `Removed ${id} from this project.`,
    "removed",
  );
}

interface RestoreItem {
  id: string;
  version: string;
  path: string;
}

interface RestoreFailure {
  id: string;
  code: string;
  message: string;
}

export async function restoreProjectSkills(
  scope?: InstallScope,
  cwd = process.cwd(),
): Promise<
  ToolResult<{
    restored: RestoreItem[];
    failed: RestoreFailure[];
  }>
> {
  await requireCatalogAuth();

  const manifest = await readProjectManifest(cwd);
  const ids = Object.keys(manifest.skills);
  if (ids.length === 0) {
    return okResult(
      { restored: [], failed: [] },
      "skillflux.json has no skills to restore.",
      "restored",
    );
  }

  const restored: RestoreItem[] = [];
  const failed: RestoreFailure[] = [];

  for (const id of ids) {
    try {
      const result = await installSkill(id, scope, cwd);
      if (result.ok) {
        restored.push({
          id,
          version: result.data.version,
          path: result.data.path,
        });
      } else {
        failed.push({ id, code: result.code, message: result.message });
      }
    } catch (error) {
      if (error instanceof SkillFluxError) {
        failed.push({ id, code: error.code, message: error.message });
      } else {
        throw error;
      }
    }
  }

  const message =
    restored.length > 0
      ? `Restored ${restored.length} skill(s) from skillflux.json.`
      : failed.length > 0
        ? `Restore failed for ${failed.length} skill(s).`
        : "No skills were restored.";

  return okResult({ restored, failed }, message, failed.length ? "partial" : "restored");
}
