import { existsSync } from "node:fs";
import { readConfig, isFixtureMode } from "../lib/config.js";
import { CONFIG_PATH, SKILLFLUX_BIN } from "../lib/constants.js";
import { readLockfile } from "../lib/lockfile.js";
import { readProjectManifest } from "../lib/manifest.js";
import { loadPackManifest } from "../lib/pack.js";
import { projectManifestPath } from "../lib/project.js";
import { runtimeCliBin } from "../lib/runtime.js";
import { detectAgent, getAgentAdapter } from "./agents/index.js";
import type { AgentId, InstallScope } from "../lib/paths.js";

export interface DoctorOptions {
  agent?: AgentId;
  scope?: InstallScope;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<string[]> {
  const mcpScope = options.scope ?? "user";
  const agent = await detectAgent(options.agent);
  const adapter = getAgentAdapter(agent);
  const notes: string[] = [];

  notes.push(`Agent: ${agent}`);
  notes.push(`MCP scope: ${mcpScope}`);
  notes.push(`Fixture mode: ${isFixtureMode() ? "on" : "off"}`);

  notes.push(...(await adapter.doctor(mcpScope)));

  const config = await readConfig();
  if (config) {
    notes.push(`Device ID: ${config.deviceId.slice(0, 8)}…`);
    notes.push(`Device token: ${config.deviceToken ? "present" : "missing"}`);
    if (config.runtimeVersion) {
      const runtimeBin = runtimeCliBin(config.runtimeVersion);
      notes.push(
        `Runtime: ${config.runtimeVersion} (${existsSync(runtimeBin) ? "installed" : "missing"})`,
      );
    }
  } else {
    notes.push(`${CONFIG_PATH}: missing`);
  }

  notes.push(`CLI shim: ${existsSync(SKILLFLUX_BIN) ? "present" : "missing"}`);

  const manifest = await readProjectManifest();
  const lockfile = await readLockfile();
  notes.push(`Project manifest: ${existsSync(projectManifestPath()) ? "present" : "missing"}`);
  notes.push(`Project skills enabled: ${Object.keys(manifest.skills).length}`);
  notes.push(`Project lockfile entries: ${Object.keys(lockfile.skills).length}`);

  try {
    const pack = await loadPackManifest();
    notes.push(`Bundled catalog: ${pack.name}@${pack.packVersion}`);
  } catch (error) {
    notes.push(
      `Bundled catalog: unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return notes;
}
