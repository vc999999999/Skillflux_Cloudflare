import { copyDirectory, directoryExists } from "../../lib/fs-utils.js";
import { readMcpConfig, writeMcpConfig } from "../../lib/mcp-config.js";
import { resolveMcpCommand } from "../../lib/runtime.js";
import {
  bundledManagerSkillDir,
  resolveAgentBootstrapPaths,
  type AgentId,
  type InstallScope,
} from "../../lib/paths.js";
import type { AgentAdapter } from "./types.js";

const SERVER_NAME = "skillflux";

export class CursorAdapter implements AgentAdapter {
  id: AgentId = "cursor";

  async detect(): Promise<boolean> {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const { access } = await import("node:fs/promises");
    const candidates = [join(homedir(), ".cursor"), join(process.cwd(), ".cursor")];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  async registerMcp(mcpScope: InstallScope) {
    const notes: string[] = [];
    const paths = resolveAgentBootstrapPaths(this.id, mcpScope);
    const config = await readMcpConfig(paths.mcpConfigPath);
    const { command, args, display } = await resolveMcpCommand();
    config.mcpServers ??= {};
    config.mcpServers[SERVER_NAME] = { command, args };
    await writeMcpConfig(paths.mcpConfigPath, config);
    notes.push(`Registered MCP server "${SERVER_NAME}" at ${paths.mcpConfigPath}`);
    notes.push(`MCP command: ${display}`);
    return { ok: true, notes };
  }

  async unregisterMcp(mcpScope: InstallScope) {
    const notes: string[] = [];
    const paths = resolveAgentBootstrapPaths(this.id, mcpScope);
    const config = await readMcpConfig(paths.mcpConfigPath);
    if (config.mcpServers?.[SERVER_NAME]) {
      delete config.mcpServers[SERVER_NAME];
      await writeMcpConfig(paths.mcpConfigPath, config);
      notes.push(`Removed MCP server "${SERVER_NAME}" from ${paths.mcpConfigPath}`);
    }
    return { ok: true, notes };
  }

  async doctor(mcpScope: InstallScope): Promise<string[]> {
    const notes: string[] = [];
    const paths = resolveAgentBootstrapPaths(this.id, mcpScope);
    try {
      const config = await readMcpConfig(paths.mcpConfigPath);
      if (config.mcpServers?.[SERVER_NAME]) {
        notes.push(`MCP: ${SERVER_NAME} registered (${paths.mcpConfigPath})`);
      } else {
        notes.push(`MCP: ${SERVER_NAME} missing in ${paths.mcpConfigPath}`);
      }
    } catch (error) {
      notes.push(
        `MCP config error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (await directoryExists(paths.managerSkillPath)) {
      notes.push(`Manager skill: installed (${paths.managerSkillPath})`);
    } else {
      notes.push(`Manager skill: missing (${paths.managerSkillPath})`);
    }
    return notes;
  }
}

export async function installManagerSkill(agent: AgentId): Promise<{ ok: boolean; notes: string[] }> {
  const paths = resolveAgentBootstrapPaths(agent, "user");
  await copyDirectory(bundledManagerSkillDir(), paths.managerSkillPath);
  return {
    ok: true,
    notes: [`Installed skillflux-manager globally at ${paths.managerSkillPath}`],
  };
}

export async function removeManagerSkill(agent: AgentId): Promise<{ ok: boolean; notes: string[] }> {
  const { rm } = await import("node:fs/promises");
  const paths = resolveAgentBootstrapPaths(agent, "user");
  await rm(paths.managerSkillPath, { recursive: true, force: true });
  return {
    ok: true,
    notes: [`Removed skillflux-manager from ${paths.managerSkillPath}`],
  };
}
