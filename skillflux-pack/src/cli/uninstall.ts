import { getAgentAdapter, removeManagerSkill } from "./agents/index.js";
import type { AgentId, InstallScope } from "../lib/paths.js";

export interface UninstallOptions {
  agent?: AgentId;
  scope?: InstallScope;
}

export async function runUninstall(options: UninstallOptions = {}): Promise<string[]> {
  const mcpScope = options.scope ?? "user";
  const agent = options.agent ?? "cursor";
  const adapter = getAgentAdapter(agent);
  const notes: string[] = [];

  const mcpResult = await adapter.unregisterMcp(mcpScope);
  notes.push(...mcpResult.notes);

  const managerResult = await removeManagerSkill(agent);
  notes.push(...managerResult.notes);

  notes.push("Global ~/.skillflux config and project skillflux.json were kept.");
  return notes;
}
