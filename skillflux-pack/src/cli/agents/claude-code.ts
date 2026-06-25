import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyDirectory, directoryExists } from "../../lib/fs-utils.js";
import { resolveMcpCommand } from "../../lib/runtime.js";
import {
  bundledManagerSkillDir,
  resolveAgentBootstrapPaths,
  type AgentId,
  type InstallScope,
} from "../../lib/paths.js";
import type { AgentAdapter } from "./types.js";

const execFileAsync = promisify(execFile);
const SERVER_NAME = "skillflux";

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  id: AgentId = "claude-code";

  async detect(): Promise<boolean> {
    return commandExists("claude");
  }

  async registerMcp(_mcpScope: InstallScope) {
    const notes: string[] = [];
    const { command, args, display } = await resolveMcpCommand();

    if (await commandExists("claude")) {
      try {
        await execFileAsync("claude", ["mcp", "add", SERVER_NAME, "--", command, ...args], {
          env: process.env,
        });
        notes.push(`Registered MCP via claude mcp add (${SERVER_NAME})`);
        return { ok: true, notes };
      } catch (error) {
        notes.push(
          `claude mcp add failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    notes.push("Fallback: add MCP manually to Claude Code settings.");
    notes.push(`Command: ${display}`);
    return { ok: false, notes };
  }

  async unregisterMcp(_mcpScope: InstallScope) {
    const notes: string[] = [];
    if (await commandExists("claude")) {
      try {
        await execFileAsync("claude", ["mcp", "remove", SERVER_NAME], { env: process.env });
        notes.push(`Removed MCP via claude mcp remove (${SERVER_NAME})`);
        return { ok: true, notes };
      } catch (error) {
        notes.push(
          `claude mcp remove failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { ok: false, notes };
  }

  async doctor(_mcpScope: InstallScope): Promise<string[]> {
    const notes: string[] = [];
    const paths = resolveAgentBootstrapPaths(this.id, "user");
    if (await directoryExists(paths.managerSkillPath)) {
      notes.push(`Manager skill: installed (${paths.managerSkillPath})`);
    } else {
      notes.push(`Manager skill: missing (${paths.managerSkillPath})`);
    }
    notes.push("MCP registration: verify with `claude mcp list`");
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
