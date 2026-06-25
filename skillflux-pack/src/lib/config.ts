import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import type { AgentId } from "./paths.js";
import { CONFIG_PATH, SKILLFLUX_DIR } from "./constants.js";

export interface SkillFluxConfig {
  deviceId: string;
  deviceToken?: string;
  agent: AgentId;
  runtimeVersion?: string;
  fixtureMode?: boolean;
  deviceSessionId?: string;
}

export async function ensureSkillFluxDir(): Promise<void> {
  await mkdir(SKILLFLUX_DIR, { recursive: true, mode: 0o700 });
}

export async function readConfig(): Promise<SkillFluxConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as SkillFluxConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(config: SkillFluxConfig): Promise<void> {
  await ensureSkillFluxDir();
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(CONFIG_PATH, 0o600);
}

export function createDeviceId(): string {
  const seed = `${hostname()}:${userInfo().username}:${randomUUID()}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

export async function getOrCreateDeviceId(agent: AgentId): Promise<SkillFluxConfig> {
  const existing = await readConfig();
  if (existing?.deviceId) {
    return { ...existing, agent };
  }

  const config: SkillFluxConfig = {
    deviceId: createDeviceId(),
    agent,
    fixtureMode: isFixtureMode(),
  };
  await writeConfig(config);
  return config;
}

export function isFixtureMode(): boolean {
  if (process.env.SKILLFLUX_FIXTURE === "0") return false;
  if (process.env.SKILLFLUX_FIXTURE === "1") return true;
  if (process.env.SKILLFLUX_API_URL) return false;
  return true;
}

export function apiBaseUrl(): string {
  return (process.env.SKILLFLUX_API_URL ?? "https://skillflux.cn/api").replace(/\/$/, "");
}
