import { access, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureSkillFluxDir } from "./config.js";
import {
  BIN_DIR,
  CACHE_DIR,
  SKILLFLUX_BIN,
  SKILLFLUX_DIR,
} from "./constants.js";
import { packageRoot } from "./paths.js";

export function runtimeRoot(version: string): string {
  return join(SKILLFLUX_DIR, "runtime", version);
}

export function runtimeCliBin(version: string): string {
  return join(runtimeRoot(version), "dist", "bin", "skillflux.js");
}

export async function readPackageVersion(): Promise<string> {
  const raw = await readFile(join(packageRoot(), "package.json"), "utf8");
  const pkg = JSON.parse(raw) as { version: string };
  return pkg.version;
}

export async function ensureCacheDir(): Promise<void> {
  await ensureSkillFluxDir();
  await mkdir(CACHE_DIR, { recursive: true });
}

export async function syncRuntimeToLocal(): Promise<{ version: string; path: string }> {
  await ensureSkillFluxDir();
  const version = await readPackageVersion();
  const target = runtimeRoot(version);
  const cliBin = runtimeCliBin(version);

  try {
    await access(cliBin);
  } catch {
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });

    const root = packageRoot();
    for (const item of ["dist", "bootstrap", "skills"] as const) {
      await cp(join(root, item), join(target, item), { recursive: true });
    }
    await cp(join(root, "pack.json"), join(target, "pack.json"));
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify({ name: "skillflux", version }, null, 2)}\n`,
      "utf8",
    );
  }

  return { version, path: target };
}

export async function installBinShim(version: string): Promise<string> {
  await mkdir(BIN_DIR, { recursive: true });

  const shim = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const configPath = join(homedir(), ".skillflux", "config.json");
let runtimeVersion = ${JSON.stringify(version)};
try {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.runtimeVersion) runtimeVersion = config.runtimeVersion;
} catch {}

const cliPath = join(
  homedir(),
  ".skillflux",
  "runtime",
  runtimeVersion,
  "dist",
  "bin",
  "skillflux.js",
);

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
`;

  await writeFile(SKILLFLUX_BIN, shim, { mode: 0o755 });
  await chmod(SKILLFLUX_BIN, 0o755);
  return SKILLFLUX_BIN;
}

export function isDevCheckout(): boolean {
  return existsSync(join(packageRoot(), "src", "bin", "skillflux.ts"));
}

export interface McpCommandSpec {
  command: string;
  args: string[];
  display: string;
}

export async function resolveMcpCommand(): Promise<McpCommandSpec> {
  if (existsSync(SKILLFLUX_BIN)) {
    return {
      command: SKILLFLUX_BIN,
      args: ["mcp", "start"],
      display: "skillflux mcp start",
    };
  }

  if (process.env.SKILLFLUX_DEV === "1" || isDevCheckout()) {
    const compiled = join(packageRoot(), "dist", "bin", "skillflux.js");
    if (existsSync(compiled)) {
      return {
        command: process.execPath,
        args: [compiled, "mcp", "start"],
        display: `skillflux mcp start (dev: ${compiled})`,
      };
    }

    const source = join(packageRoot(), "src", "bin", "skillflux.ts");
    if (existsSync(source)) {
      return {
        command: process.execPath,
        args: ["--import", "tsx", source, "mcp", "start"],
        display: "skillflux mcp start (dev: tsx)",
      };
    }
  }

  const version = await readPackageVersion();
  return {
    command: "npx",
    args: ["-y", "-p", `skillflux@${version}`, "skillflux", "mcp", "start"],
    display: `npx -y -p skillflux@${version} skillflux mcp start`,
  };
}

/** @deprecated use runtimeCliBin */
export function runtimeMcpBin(version: string): string {
  return join(runtimeRoot(version), "dist", "bin", "skillflux-mcp.js");
}
