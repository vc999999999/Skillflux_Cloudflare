import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readConfig, isFixtureMode } from "../lib/config.js";
import { CACHE_DIR, CONFIG_PATH, SKILLFLUX_BIN } from "../lib/constants.js";
import { readLockfile } from "../lib/lockfile.js";
import { readProjectManifest } from "../lib/manifest.js";
import { loadPackManifest } from "../lib/pack.js";
import {
  projectLockfilePath,
  projectManifestPath,
  projectSkillfluxDir,
} from "../lib/project.js";
import { runtimeCliBin } from "../lib/runtime.js";
import { okResult } from "./tool-response.js";

export async function runMcpDoctor(cwd = process.cwd()) {
  const config = await readConfig();
  const manifest = await readProjectManifest(cwd);
  const lockfile = await readLockfile(cwd);

  const checks: string[] = [];
  checks.push(`Global config: ${existsSync(CONFIG_PATH) ? "present" : "missing"}`);
  checks.push(`CLI shim: ${existsSync(SKILLFLUX_BIN) ? "present" : "missing"}`);
  checks.push(`Cache dir: ${existsSync(CACHE_DIR) ? "present" : "missing"}`);
  checks.push(`Fixture mode: ${isFixtureMode() ? "on" : "off"}`);

  if (config?.runtimeVersion) {
    const runtimeBin = runtimeCliBin(config.runtimeVersion);
    checks.push(
      `Runtime ${config.runtimeVersion}: ${existsSync(runtimeBin) ? "installed" : "missing"}`,
    );
  }

  checks.push(`Project manifest: ${existsSync(projectManifestPath(cwd)) ? "present" : "missing"}`);
  checks.push(
    `Project lockfile: ${existsSync(projectLockfilePath(cwd)) ? "present" : "missing"}`,
  );
  checks.push(`Project skills dir: ${existsSync(projectSkillfluxDir(cwd)) ? "present" : "missing"}`);
  checks.push(`Enabled project skills: ${Object.keys(lockfile.skills).length}`);

  let catalogVersion: string | undefined;
  try {
    const pack = await loadPackManifest();
    catalogVersion = pack.packVersion;
  } catch {
    checks.push("Bundled catalog: unavailable");
  }

  return okResult(
    {
      agent: config?.agent,
      deviceId: config?.deviceId?.slice(0, 8),
      runtimeVersion: config?.runtimeVersion,
      projectRoot: cwd,
      projectManifest: manifest,
      installedSkills: lockfile.skills,
      catalogVersion,
      checks,
    },
    "SkillFlux local bootstrap and project state summary.",
    config?.deviceToken ? "active" : isFixtureMode() ? "fixture" : "bootstrap",
  );
}

export async function readInstalledSkillFiles(
  projectRoot: string,
  relativePath: string,
  files: string[],
): Promise<Record<string, string>> {
  const absoluteRoot = join(projectRoot, relativePath);
  const contents: Record<string, string> = {};
  for (const file of files) {
    contents[file] = await readFile(join(absoluteRoot, file), "utf8");
  }
  return contents;
}
