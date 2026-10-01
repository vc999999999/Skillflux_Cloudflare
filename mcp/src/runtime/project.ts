import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, stat, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Bundle, Host } from '../shared.js';
import { canonical } from '../shared.js';
import { CatalogClient, normalizeSourceUrl, parseRepoRef } from './catalog-client.js';
import { installBootstrapSkill } from './bootstrap.js';
import { SkillFluxError } from './errors.js';
import {
  INSTALL_MANIFEST_FILE,
  LOCK_SCHEMA,
  STATE_SCHEMA,
  type InitOptions,
  type InitResult,
  type InstallationState,
  type InstallJournal,
  type InstalledPackage,
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
  canonicalProjectRoot,
  ensureStateLayout,
  isInside,
  readJson,
  readJsonIfExists,
  runtimePaths,
  withProjectLock,
} from './paths.js';

const LOCK_HISTORY_LIMIT = 50;

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
  const staged = `${target}.${randomUUID()}.tmp`;
  await writeFile(staged, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
  await rename(staged, target);
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
  const repo = (() => { const parsed = parseRepoRef(options.repo); return `${parsed.owner}/${parsed.repo}`; })();
  const source = normalizeSourceUrl(options.source);
  // Verify the catalog source is reachable and resolves to a commit before writing any config.
  const client = new CatalogClient(repo, { source });
  const commitSha = await client.resolveHead();
  const paths = runtimePaths(projectRoot);
  await ensureStateLayout(paths);
  return withProjectLock(paths, async () => {
    for (const file of [paths.config, paths.policy, paths.trust, paths.installation, paths.lock]) {
      await assertNoSymlinkPath(projectRoot, file, true);
    }
    const existingTrust = await readJsonIfExists<TrustRecord>(paths.trust);
    if (existingTrust && (existingTrust.schema !== STATE_SCHEMA || typeof existingTrust.repo !== 'string' || !existingTrust.repo)) {
      throw new SkillFluxError('INVALID_TRUST', 'Existing trust record is not a GitHub catalog repository pin. Inspect it before initializing this project.');
    }
    const existingTrustRepo = existingTrust?.repo;
    if (existingTrustRepo && existingTrustRepo !== repo) {
      throw new SkillFluxError('TRUST_PIN_MISMATCH', `This project is pinned to catalog repository ${existingTrustRepo}. Run 'skillflux privacy --reset-trust' only after verifying that switching to ${repo} is intended.`);
    }
    const now = new Date().toISOString();
    const previousConfig = await readJsonIfExists<RuntimeConfig>(paths.config);
    const config: RuntimeConfig = {
      schema: STATE_SCHEMA,
      projectRoot,
      repo,
      source,
      host: options.host,
      cliPath: resolve(options.cliPath),
      createdAt: previousConfig?.createdAt ?? now,
    };
    const previousPolicy = await readJsonIfExists<RuntimePolicy>(paths.policy);
    const policy: RuntimePolicy = {
      schema: STATE_SCHEMA,
      preauthorizeReviewedText: options.preauthorizeReviewedText ?? previousPolicy?.preauthorizeReviewedText ?? false,
      locale: options.locale ?? previousPolicy?.locale ?? 'zh-CN',
      createdAt: previousPolicy?.createdAt ?? now,
      updatedAt: now,
    };
    const trust: TrustRecord = existingTrust && existingTrust.repo ? existingTrust : {
      schema: STATE_SCHEMA,
      repo,
      pinnedAt: now,
      method: 'repo-pin',
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
    ]);
    const mcpConfigPath = await mergeMcpConfig(projectRoot, options.cliPath, options.host);
    const bootstrapSkillPath = await installBootstrapSkill(projectRoot, options.host);
    return {
      projectRoot,
      repo,
      host: options.host,
      mcpConfigPath,
      bootstrapSkillPath,
      trust,
      trustNotice: `Pinned catalog repository ${repo} at commit ${commitSha.slice(0, 10)} (source ${source}). All downloads anchor to commit SHAs; verify the repository owner out of band before relying on it.`,
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
    throw new SkillFluxError('UNSUPPORTED_STATE', 'Project state schema is unsupported; run skillflux init again');
  }
  if (config.projectRoot !== projectRoot) throw new SkillFluxError('PROJECT_BINDING_MISMATCH', 'Runtime configuration is bound to a different canonical project root');
  if (config.repo !== trust.repo) throw new SkillFluxError('TRUST_ORIGIN_MISMATCH', 'Pinned repository does not match the configured catalog repository');
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
    await writeFile(historyPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    // Rollback only needs a bounded window; keep the newest LOCK_HISTORY_LIMIT revisions.
    const files = (await readdir(paths.history)).filter(name => name.endsWith('.json')).sort();
    for (const stale of files.slice(0, Math.max(0, files.length - LOCK_HISTORY_LIMIT))) {
      await rm(join(paths.history, stale), { force: true }).catch(() => undefined);
    }
  }
  await assertNoSymlinkPath(paths.root, paths.lock, true);
  await atomicWriteJson(paths.lock, next);
}

export async function writePlan(paths: RuntimePaths, plan: ResolutionPlan): Promise<void> {
  const target = join(paths.plans, `${plan.id}.json`);
  await assertNoSymlinkPath(paths.root, target, true);
  await writeFile(target, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export async function readPlan(paths: RuntimePaths, planId: string): Promise<ResolutionPlan> {
  if (!/^plan_[a-f0-9-]{20,}$/.test(planId)) throw new SkillFluxError('INVALID_PLAN_ID', 'Plan id is invalid');
  const target = join(paths.plans, `${planId}.json`);
  await assertNoSymlinkPath(paths.root, target, false);
  return readJson<ResolutionPlan>(target);
}

/** Write a downloaded, verified package: content files plus a local anchor manifest. */
export async function writeInstalledPackage(paths: RuntimePaths, pkg: InstalledPackage, targetRoot: string): Promise<void> {
  void paths;
  for (const [path, content] of Object.entries(pkg.files)) {
    const target = resolve(targetRoot, ...path.split('/'));
    if (!isInside(targetRoot, target)) throw new SkillFluxError('PATH_OUTSIDE_PACKAGE', `Bundle path escaped staging: ${path}`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  await writeFile(join(targetRoot, INSTALL_MANIFEST_FILE), `${JSON.stringify(pkg, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export async function readInstalledPackage(packageRoot: string): Promise<InstalledPackage> {
  const anchorPath = join(packageRoot, INSTALL_MANIFEST_FILE);
  const pkg = await readJson<InstalledPackage>(anchorPath);
  if (pkg.schema !== STATE_SCHEMA || !pkg.manifest || typeof pkg.files !== 'object') {
    throw new SkillFluxError('INSTALL_METADATA_MISMATCH', `Installed anchor is invalid under ${packageRoot}`);
  }
  return pkg;
}

export async function verifyInstalledFiles(packageRoot: string, pkg: InstalledPackage): Promise<void> {
  const anchorPath = join(packageRoot, INSTALL_MANIFEST_FILE);
  await assertNoSymlinkPath(packageRoot, anchorPath, false);
  const anchor = await readJson<InstalledPackage>(anchorPath);
  if (anchor.schema !== STATE_SCHEMA || anchor.digest !== pkg.digest || canonical(anchor.manifest) !== canonical(pkg.manifest)) {
    throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', `Installed ${INSTALL_MANIFEST_FILE} was modified or is unreadable`);
  }
  for (const [path, expected] of Object.entries(pkg.files)) {
    const target = resolve(packageRoot, ...path.split('/'));
    if (!isInside(packageRoot, target)) throw new SkillFluxError('PATH_OUTSIDE_PACKAGE', `Installed path escaped package: ${path}`);
    await assertNoSymlinkPath(packageRoot, target, false);
    const content = await readFile(target);
    if (content.byteLength !== Buffer.byteLength(expected, 'utf8') || content.toString('utf8') !== expected) {
      throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', `Installed file was modified: ${path}`);
    }
  }
  const declared = new Set([...Object.keys(pkg.files), INSTALL_MANIFEST_FILE]);
  const visit = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, item.name);
      const rel = relativePath(packageRoot, absolute);
      if (item.isSymbolicLink()) throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', `Installed package contains a symbolic link: ${rel}`);
      if (item.isDirectory()) await visit(absolute);
      else if (!item.isFile() || !declared.has(rel)) throw new SkillFluxError('LOCAL_MODIFICATION_DETECTED', `Installed package contains an undeclared file: ${rel}`);
    }
  };
  await visit(packageRoot);
}

function relativePath(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

export async function recoverJournal(paths: RuntimePaths): Promise<void> {
  await assertNoSymlinkPath(paths.root, paths.journal, true);
  const journal = await readJsonIfExists<InstallJournal>(paths.journal);
  if (!journal) return;
  if (journal.schema !== STATE_SCHEMA || !journal.nextLock || !journal.previousLock) {
    throw new SkillFluxError('INVALID_JOURNAL', 'Install journal is invalid; refusing unsafe automatic recovery');
  }
  if (journal.operation === 'install' && journal.phase === 'prepared') {
    // The previous lock is still authoritative; the staged directory is garbage.
    if (journal.stageRoot) await rm(journal.stageRoot, { recursive: true, force: true }).catch(() => undefined);
    await assertNoSymlinkPath(paths.root, paths.lock, true);
    await atomicWriteJson(paths.lock, journal.previousLock);
    await rm(paths.journal, { force: true });
    return;
  }
  if (journal.phase === 'materialized') {
    await assertNoSymlinkPath(paths.root, paths.lock, true);
    await atomicWriteJson(paths.lock, journal.nextLock);
    if (journal.operation === 'install' && journal.stageRoot) await rm(journal.stageRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(paths.journal, { force: true });
  }
}

export async function moveDirectoryAtomic(source: string, target: string): Promise<boolean> {
  const targetInfo = await stat(target).catch(() => null);
  if (targetInfo) return false;
  await rename(source, target);
  return true;
}
