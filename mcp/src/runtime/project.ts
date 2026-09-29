import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Bundle, Host, Signed } from '../shared.js';
import { canonical, sha256 } from '../shared.js';
import { RegistryClient, normalizeRegistryUrl } from './api-client.js';
import { installBootstrapSkill } from './bootstrap.js';
import { SkillFluxError } from './errors.js';
import { QUALIFICATION_FILE } from './qualification.js';
import {
  LOCK_SCHEMA,
  STATE_SCHEMA,
  type AdFrequencyState,
  type InitOptions,
  type InitResult,
  type InstallationState,
  type InstallJournal,
  type InstalledEnvelope,
  type ProjectLock,
  type ResolutionPlan,
  type ResolutionPlanBody,
  type RuntimeConfig,
  type RuntimePaths,
  type RuntimePolicy,
  type TrustRecord,
} from './model.js';
import {
  assertNoSymlinkPath,
  atomicWriteJson,
  atomicWriteText,
  canonicalProjectRoot,
  ensureStateLayout,
  isInside,
  readJson,
  readJsonIfExists,
  removeIfExists,
  runtimePaths,
  withProjectLock,
} from './paths.js';

export function emptyLock(): ProjectLock {
  return { schema: LOCK_SCHEMA, revision: 0, updatedAt: new Date().toISOString(), skills: {} };
}

function validateHost(host: string): asserts host is Host {
  if (!['generic', 'codex', 'claude', 'cursor'].includes(host)) throw new SkillFluxError('INVALID_HOST', `Unsupported host: ${host}`);
}

function mcpServerEntry(cliPath: string, projectRoot: string): Record<string, unknown> {
  return {
    command: process.execPath,
    args: [resolve(cliPath), 'serve', '--project', projectRoot],
  };
}

async function mergeJsonMcpConfig(target: string, projectRoot: string, cliPath: string): Promise<string> {
  await assertNoSymlinkPath(projectRoot, dirname(target), true);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(projectRoot, dirname(target), false);
  await assertNoSymlinkPath(projectRoot, target, true);
  const existing = await readJsonIfExists<Record<string, unknown>>(target) ?? {};
  if (!existing || Array.isArray(existing) || typeof existing !== 'object') throw new SkillFluxError('INVALID_MCP_CONFIG', '.mcp.json must contain a JSON object');
  const previousServers = existing.mcpServers;
  if (previousServers !== undefined && (!previousServers || Array.isArray(previousServers) || typeof previousServers !== 'object')) {
    throw new SkillFluxError('INVALID_MCP_CONFIG', '.mcp.json mcpServers must be an object');
  }
  const servers = { ...((previousServers ?? {}) as Record<string, unknown>) };
  const oldEntry = servers.skillflux;
  const preserved = oldEntry && !Array.isArray(oldEntry) && typeof oldEntry === 'object' ? oldEntry as Record<string, unknown> : {};
  const oldArgs = Array.isArray(preserved.args) ? preserved.args : [];
  const recognizedManagedEntry = typeof preserved.command === 'string'
    && oldArgs.includes('serve')
    && oldArgs.some(value => value === projectRoot);
  if (oldEntry !== undefined && !recognizedManagedEntry) {
    throw new SkillFluxError('MCP_CONFIG_CONFLICT', `A non-SkillFlux-owned mcpServers.skillflux entry already exists in ${target}; preserve it and configure SkillFlux manually.`);
  }
  servers.skillflux = { ...preserved, ...mcpServerEntry(cliPath, projectRoot) };
  await atomicWriteJson(target, { ...existing, mcpServers: servers }, 0o644);
  return target;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function mergeCodexMcpConfig(projectRoot: string, cliPath: string): Promise<string> {
  const target = join(projectRoot, '.codex', 'config.toml');
  await assertNoSymlinkPath(projectRoot, dirname(target), true);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(projectRoot, dirname(target), false);
  await assertNoSymlinkPath(projectRoot, target, true);
  const existing = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const lines = existing.split(/\r?\n/);
  const header = '[mcp_servers.skillflux]';
  const start = lines.findIndex(line => line.trim() === header);
  const managedLines = [
    header,
    '# skillflux-managed:v1',
    `command = ${tomlString(process.execPath)}`,
    `args = [${[resolve(cliPath), 'serve', '--project', projectRoot].map(tomlString).join(', ')}]`,
  ];
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1;
    const existingSection = lines.slice(start + 1, end);
    if (!existingSection.some(line => line.trim() === '# skillflux-managed:v1')) {
      throw new SkillFluxError('MCP_CONFIG_CONFLICT', `A non-SkillFlux-owned ${header} section already exists in ${target}; preserve it and configure SkillFlux manually.`);
    }
    lines.splice(start, end - start, ...managedLines);
  } else {
    while (lines.length && lines.at(-1)?.trim() === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(...managedLines);
  }
  await atomicWriteText(target, `${lines.join('\n')}\n`, 0o644);
  return target;
}

async function mergeMcpConfig(projectRoot: string, cliPath: string, host: Host): Promise<string> {
  if (host === 'codex') return mergeCodexMcpConfig(projectRoot, cliPath);
  if (host === 'cursor') return mergeJsonMcpConfig(join(projectRoot, '.cursor', 'mcp.json'), projectRoot, cliPath);
  return mergeJsonMcpConfig(join(projectRoot, '.mcp.json'), projectRoot, cliPath);
}

export async function initializeProject(options: InitOptions): Promise<InitResult> {
  validateHost(options.host);
  const projectRoot = await canonicalProjectRoot(options.projectRoot);
  const registry = normalizeRegistryUrl(options.registry);
  const client = new RegistryClient(registry);
  const remoteKey = await client.getKey();
  if (!remoteKey?.keyId || !remoteKey.publicKey) throw new SkillFluxError('INVALID_REGISTRY_KEY', 'Registry returned an invalid public key');
  const paths = runtimePaths(projectRoot);
  await ensureStateLayout(paths);
  return withProjectLock(paths, async () => {
  for (const file of [paths.config, paths.policy, paths.trust, paths.installation, paths.lock, paths.adFrequency, paths.eventOutbox]) {
    await assertNoSymlinkPath(projectRoot, file, true);
  }
  const existingTrust = await readJsonIfExists<TrustRecord>(paths.trust);
  if (existingTrust && (existingTrust.registryOrigin !== client.origin || existingTrust.keyId !== remoteKey.keyId || existingTrust.publicKey !== remoteKey.publicKey)) {
    throw new SkillFluxError('TRUST_PIN_MISMATCH', 'The registry identity differs from the explicitly pinned key. Run `skillflux privacy --reset-trust` only after independently verifying the new key.');
  }
  const now = new Date().toISOString();
  const previousConfig = await readJsonIfExists<RuntimeConfig>(paths.config);
  const config: RuntimeConfig = {
    schema: STATE_SCHEMA,
    projectRoot,
    registry,
    host: options.host,
    cliPath: resolve(options.cliPath),
    createdAt: previousConfig?.createdAt ?? now,
  };
  const previousPolicy = await readJsonIfExists<RuntimePolicy>(paths.policy);
  const policy: RuntimePolicy = {
    schema: STATE_SCHEMA,
    preauthorizeReviewedText: options.preauthorizeReviewedText ?? previousPolicy?.preauthorizeReviewedText ?? false,
    adsEnabled: previousPolicy?.adsEnabled ?? true,
    locale: options.locale ?? previousPolicy?.locale ?? 'zh-CN',
    createdAt: previousPolicy?.createdAt ?? now,
    updatedAt: now,
  };
  const trust: TrustRecord = existingTrust ?? {
    schema: STATE_SCHEMA,
    registryOrigin: client.origin,
    keyId: remoteKey.keyId,
    publicKey: remoteKey.publicKey,
    pinnedAt: now,
    method: 'TOFU',
  };
  const installation = await readJsonIfExists<InstallationState>(paths.installation) ?? {
    schema: STATE_SCHEMA,
    installationId: randomUUID(),
    planSecret: randomBytes(32).toString('base64url'),
    createdAt: now,
    rotatedAt: now,
  };
  await Promise.all([
    atomicWriteJson(paths.config, config),
    atomicWriteJson(paths.policy, policy),
    atomicWriteJson(paths.trust, trust),
    atomicWriteJson(paths.installation, installation),
    atomicWriteJson(paths.lock, await readJsonIfExists<ProjectLock>(paths.lock) ?? emptyLock()),
    atomicWriteJson(paths.adFrequency, await readJsonIfExists<AdFrequencyState>(paths.adFrequency) ?? { schema: STATE_SCHEMA, records: [] }),
    atomicWriteJson(paths.eventOutbox, await readJsonIfExists<unknown[]>(paths.eventOutbox) ?? []),
  ]);
  const mcpConfigPath = await mergeMcpConfig(projectRoot, options.cliPath, options.host);
  const bootstrapSkillPath = await installBootstrapSkill(projectRoot, options.host);
  return {
    projectRoot,
    registry,
    host: options.host,
    mcpConfigPath,
    bootstrapSkillPath,
    trust,
    trustNotice: `TOFU: pinned registry key ${trust.keyId} for ${trust.registryOrigin}. Verify this fingerprint out of band before relying on it: ${sha256(trust.publicKey)}`,
  };
  });
}

export async function loadRuntimeState(projectRootInput: string): Promise<{
  paths: RuntimePaths;
  config: RuntimeConfig;
  policy: RuntimePolicy;
  trust: TrustRecord;
  installation: InstallationState;
}> {
  const projectRoot = await canonicalProjectRoot(projectRootInput);
  const paths = runtimePaths(projectRoot);
  await ensureStateLayout(paths);
  for (const file of [paths.config, paths.policy, paths.trust, paths.installation]) await assertNoSymlinkPath(projectRoot, file, false);
  const [config, policy, trust, installation] = await Promise.all([
    readJson<RuntimeConfig>(paths.config),
    readJson<RuntimePolicy>(paths.policy),
    readJson<TrustRecord>(paths.trust),
    readJson<InstallationState>(paths.installation),
  ]);
  if (config.schema !== STATE_SCHEMA || policy.schema !== STATE_SCHEMA || trust.schema !== STATE_SCHEMA || installation.schema !== STATE_SCHEMA) {
    throw new SkillFluxError('UNSUPPORTED_STATE', 'Project state schema is unsupported');
  }
  if (config.projectRoot !== projectRoot) throw new SkillFluxError('PROJECT_BINDING_MISMATCH', 'Runtime configuration is bound to a different canonical project root');
  const client = new RegistryClient(config.registry);
  if (client.origin !== trust.registryOrigin) throw new SkillFluxError('TRUST_ORIGIN_MISMATCH', 'Pinned key does not belong to the configured registry origin');
  return { paths, config, policy, trust, installation };
}

export function sealPlan(body: ResolutionPlanBody, secret: string): ResolutionPlan {
  return { ...body, seal: createHmac('sha256', Buffer.from(secret, 'base64url')).update(canonical(body)).digest('base64url') };
}

export function verifyPlanSeal(plan: ResolutionPlan, secret: string): ResolutionPlanBody {
  const { seal, ...body } = plan;
  const expected = createHmac('sha256', Buffer.from(secret, 'base64url')).update(canonical(body)).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(seal, 'base64url');
  } catch {
    throw new SkillFluxError('INVALID_PLAN', 'Plan seal is invalid');
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SkillFluxError('INVALID_PLAN', 'Plan has been modified');
  return body;
}

export async function readLock(paths: RuntimePaths): Promise<ProjectLock> {
  await assertNoSymlinkPath(paths.root, paths.lock, false);
  const lock = await readJson<ProjectLock>(paths.lock);
  if (lock.schema !== LOCK_SCHEMA || !lock.skills || typeof lock.skills !== 'object') throw new SkillFluxError('INVALID_LOCK', 'Project lockfile is invalid');
  return lock;
}

export async function writeLockWithHistory(paths: RuntimePaths, previous: ProjectLock, next: ProjectLock): Promise<void> {
  await assertNoSymlinkPath(paths.root, paths.history, false);
  await assertNoSymlinkPath(paths.root, paths.lock, false);
  if (previous.revision !== next.revision) {
    const historyPath = join(paths.history, `${String(previous.revision).padStart(8, '0')}-${Date.now()}-${randomUUID()}.json`);
    await assertNoSymlinkPath(paths.root, historyPath, true);
    await atomicWriteJson(historyPath, previous);
  }
  await atomicWriteJson(paths.lock, next);
}

export async function writePlan(paths: RuntimePaths, plan: ResolutionPlan): Promise<void> {
  await assertNoSymlinkPath(paths.root, paths.plans, false);
  const target = join(paths.plans, `${plan.id}.json`);
  await assertNoSymlinkPath(paths.root, target, true);
  await atomicWriteJson(target, plan);
}

export async function readPlan(paths: RuntimePaths, planId: string): Promise<ResolutionPlan> {
  if (!/^plan_[a-f0-9-]{20,}$/.test(planId)) throw new SkillFluxError('INVALID_PLAN_ID', 'Plan id is invalid');
  const target = join(paths.plans, `${planId}.json`);
  await assertNoSymlinkPath(paths.root, target, false);
  return readJson<ResolutionPlan>(target);
}

export async function writeInstalledBundle(paths: RuntimePaths, envelope: Signed<Bundle>, digest: string, targetRoot: string): Promise<void> {
  const manifest = envelope.payload.manifest;
  for (const [path, content] of Object.entries(envelope.payload.files)) {
    const target = resolve(targetRoot, ...path.split('/'));
    if (!isInside(targetRoot, target)) throw new SkillFluxError('PATH_OUTSIDE_PACKAGE', `Bundle path escaped staging: ${path}`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  const installed: InstalledEnvelope = { schema: STATE_SCHEMA, digest, envelope, installedAt: new Date().toISOString() };
  await writeFile(join(targetRoot, '.skillflux-envelope.json'), `${JSON.stringify(installed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await writeFile(join(targetRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export async function verifyInstalledFiles(packageRoot: string, bundle: Bundle): Promise<void> {
  await assertNoSymlinkPath(packageRoot, packageRoot, false);
  const manifestPath = join(packageRoot, 'manifest.json');
  await assertNoSymlinkPath(packageRoot, manifestPath, false);
  try {
    if (canonical(await readJson<unknown>(manifestPath)) !== canonical(bundle.manifest)) throw new Error('Manifest differs from signed metadata');
  } catch {
    throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', 'Installed manifest.json was modified or is unreadable');
  }
  for (const declared of bundle.manifest.files) {
    const target = resolve(packageRoot, ...declared.path.split('/'));
    if (!isInside(packageRoot, target)) throw new SkillFluxError('PATH_OUTSIDE_PACKAGE', `Installed path escaped package: ${declared.path}`);
    await assertNoSymlinkPath(packageRoot, target, false);
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) throw new SkillFluxError('INSTALLED_FILE_INVALID', `Installed file is missing or is not a regular file: ${declared.path}`);
    const content = await readFile(target);
    if (content.byteLength !== declared.size || sha256(content) !== declared.sha256) {
      throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', `Installed file was modified: ${declared.path}`);
    }
  }
  const allowed = new Set([...bundle.manifest.files.map(file => file.path), 'manifest.json', '.skillflux-envelope.json', QUALIFICATION_FILE]);
  const visit = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, item.name);
      const rel = relative(packageRoot, absolute).split(sep).join('/');
      if (item.isSymbolicLink()) throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', `Installed package contains a symbolic link: ${rel}`);
      if (item.isDirectory()) await visit(absolute);
      else if (!item.isFile() || !allowed.has(rel)) throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', `Installed package contains an undeclared file: ${rel}`);
    }
  };
  await visit(packageRoot);
}

export async function recoverJournal(paths: RuntimePaths): Promise<void> {
  await assertNoSymlinkPath(paths.root, paths.journal, true);
  const journal = await readJsonIfExists<InstallJournal>(paths.journal);
  if (!journal) return;
  if (journal.schema !== STATE_SCHEMA || !journal.nextLock || !journal.previousLock) {
    throw new SkillFluxError('INVALID_JOURNAL', 'Install journal is invalid; refusing unsafe automatic recovery');
  }
  if (journal.phase === 'materialized') await writeLockWithHistory(paths, journal.previousLock, journal.nextLock);
  if (journal.stageRoot && isInside(paths.staging, journal.stageRoot)) await removeIfExists(journal.stageRoot);
  await rm(paths.journal, { force: true });
}

export async function moveDirectoryAtomic(source: string, target: string): Promise<boolean> {
  const existing = await stat(target).catch(() => null);
  if (existing) return false;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await rename(source, target);
  return true;
}
