import type { AgentId, InstallScope } from "../../lib/paths.js";

export interface InstallResult {
  agent: AgentId;
  scope: InstallScope;
  mcpRegistered: boolean;
  managerSkillInstalled: boolean;
  notes: string[];
}

export interface AgentAdapter {
  id: AgentId;
  detect(): Promise<boolean>;
  registerMcp(mcpScope: InstallScope): Promise<{ ok: boolean; notes: string[] }>;
  unregisterMcp(mcpScope: InstallScope): Promise<{ ok: boolean; notes: string[] }>;
  doctor(mcpScope: InstallScope): Promise<string[]>;
}
