import { access } from "node:fs/promises";
import { Command } from "commander";
import { startMcpServer } from "../mcp/server.js";
import { projectManifestPath } from "../lib/project.js";
import { runDoctor } from "./doctor.js";
import { runInstall } from "./install.js";
import { runRestore } from "./restore.js";
import { runUninstall } from "./uninstall.js";
import type { AgentId, InstallScope } from "../lib/paths.js";

function parseAgent(value: string): AgentId {
  if (value === "cursor" || value === "claude-code" || value === "codex") {
    return value;
  }
  throw new Error(`Unsupported agent: ${value}`);
}

function parseScope(value: string): InstallScope {
  if (value === "user" || value === "project") {
    return value;
  }
  throw new Error(`Unsupported scope: ${value}`);
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("skillflux")
    .description("SkillFlux curated skill marketplace — installer and MCP package manager")
    .version("0.1.0");

  program
    .command("install")
    .description("Register skillflux MCP and install skillflux-manager globally")
    .option("--agent <agent>", "Target agent: cursor | claude-code | codex", parseAgent)
    .option(
      "--scope <scope>",
      "MCP config scope: user | project (manager skill is always global)",
      parseScope,
    )
    .action(async (options: { agent?: AgentId; scope?: InstallScope }) => {
      const result = await runInstall(options);
      for (const note of result.notes) {
        console.log(note);
      }
      if (!result.mcpRegistered || !result.managerSkillInstalled) {
        process.exitCode = 1;
      }
    });

  program
    .command("restore")
    .description("Install all skills declared in ./skillflux.json")
    .option(
      "--scope <scope>",
      "Install scope: user | project (default project)",
      parseScope,
    )
    .action(async (options: { scope?: InstallScope }) => {
      const notes = await runRestore({ scope: options.scope });
      for (const note of notes) {
        console.log(note);
      }
      if (notes.some((note) => note.includes("failed"))) {
        process.exitCode = 1;
      }
    });

  program
    .command("doctor")
    .description("Check local SkillFlux bootstrap installation")
    .option("--agent <agent>", "Target agent: cursor | claude-code | codex", parseAgent)
    .option("--scope <scope>", "MCP config scope: user | project", parseScope)
    .action(async (options: { agent?: AgentId; scope?: InstallScope }) => {
      const notes = await runDoctor(options);
      for (const note of notes) {
        console.log(note);
      }
    });

  program
    .command("uninstall")
    .description("Remove MCP registration and skillflux-manager")
    .option("--agent <agent>", "Target agent: cursor | claude-code | codex", parseAgent)
    .option("--scope <scope>", "MCP config scope: user | project", parseScope)
    .action(async (options: { agent?: AgentId; scope?: InstallScope }) => {
      const notes = await runUninstall(options);
      for (const note of notes) {
        console.log(note);
      }
    });

  const mcpCommand = program.command("mcp").description("SkillFlux MCP server commands");

  mcpCommand
    .command("start")
    .description("Start the SkillFlux MCP server over stdio")
    .action(async () => {
      await startMcpServer();
    });

  await program.parseAsync(argv);
}
