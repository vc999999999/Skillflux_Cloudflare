import type { AgentId, InstallScope } from "../../lib/paths.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import type { AgentAdapter } from "./types.js";

export function getAgentAdapter(agent: AgentId): AgentAdapter {
  switch (agent) {
    case "cursor":
      return new CursorAdapter();
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "codex":
      return new CodexAdapter();
  }
}

export async function detectAgent(preferred?: AgentId): Promise<AgentId> {
  if (preferred) return preferred;

  const adapters: AgentAdapter[] = [
    new CursorAdapter(),
    new ClaudeCodeAdapter(),
    new CodexAdapter(),
  ];

  for (const adapter of adapters) {
    if (await adapter.detect()) {
      return adapter.id;
    }
  }

  return "cursor";
}

export async function installManagerSkill(
  agent: AgentId,
): Promise<{ ok: boolean; notes: string[] }> {
  switch (agent) {
    case "cursor":
      return (await import("./cursor.js")).installManagerSkill(agent);
    case "claude-code":
      return (await import("./claude-code.js")).installManagerSkill(agent);
    case "codex":
      return (await import("./codex.js")).installManagerSkill(agent);
  }
}

export async function removeManagerSkill(
  agent: AgentId,
): Promise<{ ok: boolean; notes: string[] }> {
  switch (agent) {
    case "cursor":
      return (await import("./cursor.js")).removeManagerSkill(agent);
    case "claude-code":
      return (await import("./claude-code.js")).removeManagerSkill(agent);
    case "codex":
      return (await import("./codex.js")).removeManagerSkill(agent);
  }
}
