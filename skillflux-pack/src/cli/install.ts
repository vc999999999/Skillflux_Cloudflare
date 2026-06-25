import { access } from "node:fs/promises";
import { getOrCreateDeviceId, isFixtureMode, writeConfig } from "../lib/config.js";
import { projectManifestPath } from "../lib/project.js";
import {
  ensureCacheDir,
  installBinShim,
  syncRuntimeToLocal,
} from "../lib/runtime.js";
import {
  detectAgent,
  getAgentAdapter,
  installManagerSkill,
} from "./agents/index.js";
import type { AgentId, InstallScope } from "../lib/paths.js";
import type { InstallResult } from "./agents/types.js";
import { runRestore } from "./restore.js";

export interface InstallOptions {
  agent?: AgentId;
  scope?: InstallScope;
}

export async function runInstall(options: InstallOptions = {}): Promise<InstallResult> {
  const mcpScope = options.scope ?? "user";
  const agent = await detectAgent(options.agent);
  const adapter = getAgentAdapter(agent);
  const notes: string[] = [];

  notes.push(`Detected agent: ${agent} (MCP scope: ${mcpScope})`);

  const runtime = await syncRuntimeToLocal();
  notes.push(`Synced runtime to ~/.skillflux/runtime/${runtime.version}/`);

  await ensureCacheDir();
  notes.push("Initialized ~/.skillflux/cache/");

  const shimPath = await installBinShim(runtime.version);
  notes.push(`Installed CLI shim at ${shimPath}`);

  const config = await getOrCreateDeviceId(agent);
  config.runtimeVersion = runtime.version;
  config.fixtureMode = isFixtureMode();
  await writeConfig(config);

  const mcpResult = await adapter.registerMcp(mcpScope);
  notes.push(...mcpResult.notes);

  const managerResult = await installManagerSkill(agent);
  notes.push(...managerResult.notes);

  notes.push(`Initialized ~/.skillflux/config.json (deviceId: ${config.deviceId.slice(0, 8)}…)`);
  notes.push("Project skills install to ./.skillflux/skills/ and update ./skillflux.json.");

  if (config.fixtureMode) {
    notes.push("Fixture mode enabled — auth.status returns active for local P0 testing.");
    notes.push("Set SKILLFLUX_API_URL to use production API when ready.");
  }

  notes.push("Restart your agent session, then ask it to install skills for this project.");

  try {
    await access(projectManifestPath());
    notes.push("Found skillflux.json — restoring declared project skills...");
    notes.push(...(await runRestore({ scope: "project" })));
  } catch {
    // No project manifest in current directory.
  }

  return {
    agent,
    scope: mcpScope,
    mcpRegistered: mcpResult.ok,
    managerSkillInstalled: managerResult.ok,
    notes,
  };
}
