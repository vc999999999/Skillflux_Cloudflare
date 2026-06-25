import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BIN_DIR, CACHE_DIR, SKILLFLUX_BIN, SKILLFLUX_DIR } from "./constants.js";

export { SKILLFLUX_DIR, CONFIG_PATH, CACHE_DIR, BIN_DIR, SKILLFLUX_BIN } from "./constants.js";

export type AgentId = "cursor" | "claude-code" | "codex";
/** Bootstrap MCP scope; paid skills use project scope via `.skillflux/skills/`. */
export type InstallScope = "user" | "project";

export interface AgentBootstrapPaths {
  mcpConfigPath: string;
  managerSkillPath: string;
}

export function packageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

export function bundledPackPath(): string {
  return join(packageRoot(), "pack.json");
}

export function bundledSkillsDir(): string {
  return join(packageRoot(), "skills");
}

export function bundledManagerSkillDir(): string {
  return join(packageRoot(), "bootstrap", "skillflux-manager");
}

export function resolveAgentBootstrapPaths(
  agent: AgentId,
  mcpScope: InstallScope = "user",
  cwd = process.cwd(),
): AgentBootstrapPaths {
  const home = homedir();

  switch (agent) {
    case "cursor": {
      const userMcp = join(home, ".cursor", "mcp.json");
      const projectMcp = join(cwd, ".cursor", "mcp.json");
      return {
        mcpConfigPath: mcpScope === "project" ? projectMcp : userMcp,
        managerSkillPath: join(home, ".cursor", "skills", "skillflux-manager"),
      };
    }
    case "claude-code":
      return {
        mcpConfigPath: join(home, ".claude.json"),
        managerSkillPath: join(home, ".claude", "skills", "skillflux-manager"),
      };
    case "codex":
      return {
        mcpConfigPath: join(home, ".codex", "config.toml"),
        managerSkillPath: join(home, ".codex", "skills", "skillflux-manager"),
      };
  }
}

/** @deprecated use resolveAgentBootstrapPaths */
export function resolveAgentPaths(
  agent: AgentId,
  scope: InstallScope,
  cwd = process.cwd(),
): AgentBootstrapPaths & { skillsDir: string; mcpScope: InstallScope } {
  const paths = resolveAgentBootstrapPaths(agent, scope, cwd);
  return {
    ...paths,
    skillsDir: paths.managerSkillPath.replace(/\/skillflux-manager$/, ""),
    mcpScope: scope,
  };
}
