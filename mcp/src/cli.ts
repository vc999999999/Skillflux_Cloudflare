#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import type { Host } from './shared.js';
import { createRegistryServer } from './registry/server.js';
import { backupRegistry, checkRegistryBackup, registryKeyId, restoreRegistryBackup } from './registry/maintenance.js';
import { serveSkillFluxStdio } from './mcp-server.js';
import { initializeProject } from './runtime/project.js';
import { errorMessage, SkillFluxError } from './runtime/errors.js';
import { runManaged } from './runtime/managed-run.js';
import { SkillFluxRuntime } from './runtime/runtime.js';

const DEFAULT_REGISTRY = 'http://127.0.0.1:8787';

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return 0;
  }
  if (command === 'registry') return registryCommand(args);
  if (command === 'init') return initCommand(args);
  if (command === 'serve') return serveCommand(args);
  if (command === 'search') return searchCommand(args);
  if (command === 'plan') return planCommand(args);
  if (command === 'install') return installCommand(args);
  if (command === 'load') return loadCommand(args);
  if (command === 'list') return listCommand(args);
  if (command === 'update') return updateCommand(args);
  if (command === 'check-updates' || command === 'outdated') return checkUpdatesCommand(args);
  if (command === 'pin' || command === 'unpin') return pinCommand(args, command === 'pin');
  if (command === 'rollback') return rollbackCommand(args);
  if (command === 'remove') return removeCommand(args);
  if (command === 'privacy') return privacyCommand(args);
  if (command === 'backup') return backupCommand(args);
  if (command === 'run') return runCommand(args);
  throw new SkillFluxError('UNKNOWN_COMMAND', `Unknown command: ${command}`);
}

async function registryCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      dev: { type: 'boolean', default: false },
      host: { type: 'string' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      'public-url': { type: 'string' },
      'allowed-origin': { type: 'string', multiple: true },
      'trusted-proxy': { type: 'string', multiple: true },
    },
  });
  const dev = parsed.values.dev ?? false;
  const host = parsed.values.host ?? process.env.SKILLFLUX_HOST ?? '127.0.0.1';
  const port = parsePort(parsed.values.port ?? process.env.SKILLFLUX_PORT ?? '8787');
  const dataDir = resolve(parsed.values['data-dir'] ?? process.env.SKILLFLUX_DATA_DIR ?? join(process.cwd(), '.skillflux-registry'));
  const publicUrl = parsed.values['public-url'] ?? process.env.SKILLFLUX_PUBLIC_URL;
  const envOrigins = process.env.SKILLFLUX_ALLOWED_ORIGINS?.split(',').map(item => item.trim()).filter(Boolean);
  const allowedOrigins = parsed.values['allowed-origin'] ?? envOrigins;
  const envTrustedProxies = process.env.SKILLFLUX_TRUSTED_PROXIES?.split(',').map(item => item.trim()).filter(Boolean);
  const trustedProxies = parsed.values['trusted-proxy'] ?? envTrustedProxies;
  let adminToken = process.env.SKILLFLUX_ADMIN_TOKEN;
  if (dev && !adminToken) {
    adminToken = randomBytes(32).toString('base64url');
    process.stderr.write(`SkillFlux development operator token: ${adminToken}\n`);
  }
  const server = await createRegistryServer({
    dataDir,
    adminToken,
    allowedOrigins,
    trustedProxies,
    publicUrl,
    dev,
    seedPath: dev ? join(packageRoot(), 'catalog', 'seed.json') : undefined,
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  process.stderr.write(`SkillFlux registry listening on http://${host}:${actualPort}\n`);
  const close = (): void => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise<void>((resolveClose, rejectClose) => {
    server.once('close', resolveClose);
    server.once('error', rejectClose);
  });
  return 0;
}

async function initCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      project: { type: 'string' },
      registry: { type: 'string' },
      host: { type: 'string' },
      locale: { type: 'string' },
      'preauthorize-reviewed-text': { type: 'boolean' },
    },
  });
  const host = parseHost(parsed.values.host ?? 'generic');
  const cliPath = await compiledCliPath();
  const result = await initializeProject({
    projectRoot: parsed.values.project ?? process.cwd(),
    registry: parsed.values.registry ?? DEFAULT_REGISTRY,
    host,
    cliPath,
    locale: parsed.values.locale,
    preauthorizeReviewedText: parsed.values['preauthorize-reviewed-text'],
  });
  process.stderr.write(`${result.trustNotice}\n`);
  printJson(result);
  return 0;
}

async function serveCommand(args: string[]): Promise<number> {
  const parsed = parseProjectArgs(args);
  await serveSkillFluxStdio(parsed.project);
  return 0;
}

async function searchCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      project: { type: 'string' }, category: { type: 'string' }, host: { type: 'string' }, sort: { type: 'string' },
      limit: { type: 'string' }, offset: { type: 'string' },
    },
  });
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  const result = await runtime.search({
    query: parsed.positionals.join(' '),
    category: parsed.values.category,
    host: parsed.values.host ? parseHost(parsed.values.host) : undefined,
    sort: parseSort(parsed.values.sort),
    limit: parseInteger(parsed.values.limit, 12, 'limit'),
    offset: parseInteger(parsed.values.offset, 0, 'offset'),
  });
  printJson(result);
  return 0;
}

async function planCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { project: { type: 'string' }, version: { type: 'string' } } });
  const skillId = requireOnePositional(parsed.positionals, 'plan requires exactly one skill id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  const specifier = parseSkillSpecifier(skillId, parsed.values.version);
  printJson(await runtime.createPlan(specifier.id, { version: specifier.version }));
  return 0;
}

async function installCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { project: { type: 'string' }, version: { type: 'string' } } });
  const target = requireOnePositional(parsed.positionals, 'install requires exactly one skill id or plan id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  if (target.startsWith('plan_') && parsed.values.version) throw new SkillFluxError('INVALID_ARGUMENTS', '--version cannot be combined with a plan id');
  const specifier = target.startsWith('plan_') ? null : parseSkillSpecifier(target, parsed.values.version);
  const planId = target.startsWith('plan_') ? target : (await runtime.createPlan(specifier!.id, { version: specifier!.version })).id;
  printJson(await runtime.installPlan(planId, 'cli'));
  return 0;
}

async function loadCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: { project: { type: 'string' }, resource: { type: 'string', multiple: true }, 'no-ad': { type: 'boolean', default: false } },
  });
  const skillId = requireOnePositional(parsed.positionals, 'load requires exactly one skill id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  printJson(await runtime.load(skillId, parsed.values.resource ?? [], !(parsed.values['no-ad'] ?? false)));
  return 0;
}

async function listCommand(args: string[]): Promise<number> {
  const parsed = parseProjectArgs(args);
  printJson(await (await SkillFluxRuntime.open(parsed.project)).list());
  return 0;
}

async function updateCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: {
    project: { type: 'string' }, version: { type: 'string' }, plan: { type: 'string' }, yes: { type: 'boolean', default: false },
  } });
  if (parsed.positionals.length > 1) throw new SkillFluxError('INVALID_ARGUMENTS', 'update accepts at most one skill id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  if (parsed.values.plan && (parsed.positionals.length || parsed.values.version)) throw new SkillFluxError('INVALID_ARGUMENTS', '--plan cannot be combined with a skill or version');
  if (!parsed.values.plan && !parsed.positionals.length && parsed.values.version) throw new SkillFluxError('INVALID_ARGUMENTS', '--version requires a skill id');
  const specifier = parsed.positionals[0] ? parseSkillSpecifier(parsed.positionals[0], parsed.values.version) : null;
  if (!parsed.values.plan && !specifier?.version) {
    printJson({ ...await runtime.checkUpdates(specifier?.id, true), nextStep: 'Select an exact target with update SKILL@VERSION, or review a plan and run update --plan PLAN_ID --yes. No versions were changed.' });
    return 0;
  }
  const plan = parsed.values.plan ? await runtime.inspectPlan(parsed.values.plan) : await runtime.createPlan(specifier!.id, { version: specifier!.version });
  if (plan.intent !== 'update') throw new SkillFluxError('NOT_AN_UPDATE_PLAN', 'The selected version does not change an installed skill');
  process.stderr.write(`Update plan ${plan.id} (expires ${plan.expiresAt}):\n${plan.changes!.map(change => `${change.id}: ${change.from} → ${change.to}${change.breaking ? ' [BREAKING]' : ''}\n${change.notes}`).join('\n')}\n`);
  let confirmed = parsed.values.yes;
  if (!confirmed && process.stdin.isTTY && process.stderr.isTTY) {
    const input = createInterface({ input: process.stdin, output: process.stderr });
    try { confirmed = (await input.question('Install these exact versions? [y/N] ')).trim().toLowerCase() === 'y'; } finally { input.close(); }
  }
  if (!confirmed) {
    printJson({ plan, installed: false, nextStep: `After reviewing, run skillflux update --plan ${plan.id} --yes --project ${JSON.stringify(runtime.paths.root)}` });
    return 0;
  }
  printJson(await runtime.installUpdatePlan(plan.id, 'cli'));
  return 0;
}

async function checkUpdatesCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { project: { type: 'string' }, cached: { type: 'boolean', default: false } } });
  if (parsed.positionals.length > 1) throw new SkillFluxError('INVALID_ARGUMENTS', 'check-updates accepts at most one skill id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  printJson(await runtime.checkUpdates(parsed.positionals[0], !parsed.values.cached));
  return 0;
}

async function pinCommand(args: string[], pinned: boolean): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { project: { type: 'string' } } });
  const id = requireOnePositional(parsed.positionals, 'pin/unpin requires exactly one installed skill id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  printJson(await runtime.setPinned(id, pinned));
  return 0;
}

async function rollbackCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { project: { type: 'string' } } });
  if (parsed.positionals.length > 1) throw new SkillFluxError('INVALID_ARGUMENTS', 'rollback accepts at most one skill id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  printJson(await runtime.rollback(parsed.positionals[0], 'cli'));
  return 0;
}

async function removeCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true, options: { project: { type: 'string' }, force: { type: 'boolean', default: false } } });
  const skillId = requireOnePositional(parsed.positionals, 'remove requires exactly one skill id');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  printJson(await runtime.remove(skillId, { actor: 'cli', force: parsed.values.force ?? false }));
  return 0;
}

async function privacyCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: { project: { type: 'string' }, 'reset-trust': { type: 'boolean', default: false } },
  });
  if (parsed.positionals.length > 1) throw new SkillFluxError('INVALID_ARGUMENTS', 'privacy accepts one action: status, reset, ads-on or ads-off');
  const action = parsed.positionals[0] ?? 'status';
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  if (parsed.values['reset-trust']) {
    await runtime.resetTrust();
    printJson({ trustReset: true, notice: 'Trust pin removed. Re-run init and verify the new TOFU fingerprint out of band.' });
    return 0;
  }
  if (action === 'ads-on') await runtime.setAdvertising(true);
  else if (action === 'ads-off') await runtime.setAdvertising(false);
  else if (action === 'reset') {
    printJson(await runtime.resetPrivacy());
    return 0;
  } else if (action !== 'status') throw new SkillFluxError('INVALID_ARGUMENTS', `Unknown privacy action: ${action}`);
  printJson(await runtime.privacyState());
  return 0;
}

async function backupCommand(args: string[]): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      'data-dir': { type: 'string' },
      dest: { type: 'string' },
      backup: { type: 'string' },
      check: { type: 'boolean', default: false },
      restore: { type: 'boolean', default: false },
      'key-id': { type: 'string' },
    },
  });
  const values = parsed.values;
  if (values.check && values.restore) throw new SkillFluxError('INVALID_ARGUMENTS', '--check and --restore cannot be combined');
  if (values['key-id'] && values['data-dir']) throw new SkillFluxError('INVALID_ARGUMENTS', '--key-id cannot be combined with --data-dir');
  const expectedKeyId = values['key-id'] ?? (values['data-dir'] && (values.check || values.restore) ? await registryKeyId(values['data-dir']) : undefined);
  if (values.check) {
    if (!values.backup || values.dest) throw new SkillFluxError('INVALID_ARGUMENTS', 'backup --check requires --backup DIR and does not accept --dest');
    printJson(await checkRegistryBackup(values.backup, expectedKeyId));
    return 0;
  }
  if (values.restore) {
    if (!values.backup || !values.dest) throw new SkillFluxError('INVALID_ARGUMENTS', 'backup --restore requires --backup DIR and --dest DIR; the destination must be a new directory');
    printJson(await restoreRegistryBackup(values.backup, values.dest, expectedKeyId));
    return 0;
  }
  if (!values['data-dir'] || !values.dest || values.backup) throw new SkillFluxError('INVALID_ARGUMENTS', 'backup requires --data-dir DIR and --dest DIR; the destination must be a new directory');
  printJson(await backupRegistry(values['data-dir'], values.dest));
  return 0;
}

async function runCommand(args: string[]): Promise<number> {
  const delimiter = args.indexOf('--');
  if (delimiter < 0 || delimiter === args.length - 1) throw new SkillFluxError('INVALID_ARGUMENTS', 'run requires `-- EXECUTABLE ARG...`; commands are never passed through a shell');
  const wrapperArgs = args.slice(0, delimiter);
  const childArgs = args.slice(delimiter + 1);
  const parsed = parseArgs({
    args: wrapperArgs,
    strict: true,
    allowPositionals: false,
    options: {
      project: { type: 'string' }, skill: { type: 'string' }, resource: { type: 'string', multiple: true },
      category: { type: 'string' }, json: { type: 'boolean', default: false }, 'ad-context': { type: 'string', default: 'unknown' },
    },
  });
  if (!parsed.values.skill) throw new SkillFluxError('INVALID_ARGUMENTS', 'run requires --skill ID');
  const adContext = parsed.values['ad-context'];
  if (adContext !== 'normal' && adContext !== 'sensitive' && adContext !== 'unknown') throw new SkillFluxError('INVALID_ARGUMENTS', '--ad-context must be normal, sensitive, or unknown');
  const runtime = await SkillFluxRuntime.open(parsed.values.project ?? process.cwd());
  const result = await runManaged(runtime, {
    command: childArgs[0],
    args: childArgs.slice(1),
    skillId: parsed.values.skill,
    resources: parsed.values.resource,
    category: parsed.values.category,
    adContext,
    json: parsed.values.json,
  });
  return result.exitCode;
}

function parseProjectArgs(args: string[]): { project: string } {
  const parsed = parseArgs({ args, strict: true, allowPositionals: false, options: { project: { type: 'string' } } });
  return { project: parsed.values.project ?? process.cwd() };
}

function parseHost(value: string): Host {
  if (value === 'generic' || value === 'codex' || value === 'claude' || value === 'cursor') return value;
  throw new SkillFluxError('INVALID_HOST', `Host must be generic, codex, claude or cursor: ${value}`);
}

function parseSort(value: string | undefined): 'relevance' | 'newest' | 'name' {
  if (value === undefined || value === 'relevance' || value === 'newest' || value === 'name') return value ?? 'relevance';
  throw new SkillFluxError('INVALID_SORT', `Unknown sort: ${value}`);
}

function parseInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new SkillFluxError('INVALID_ARGUMENTS', `${label} must be a non-negative integer`);
  return Number.parseInt(value, 10);
}

function parsePort(value: string): number {
  const port = parseInteger(value, 8787, 'port');
  if (port < 0 || port > 65535) throw new SkillFluxError('INVALID_ARGUMENTS', 'port must be between 0 and 65535');
  return port;
}

function requireOnePositional(positionals: string[], message: string): string {
  if (positionals.length !== 1) throw new SkillFluxError('INVALID_ARGUMENTS', message);
  return positionals[0];
}

function parseSkillSpecifier(value: string, versionOption?: string): { id: string; version?: string } {
  const separator = value.lastIndexOf('@');
  const hasVersion = separator > 0;
  const id = hasVersion ? value.slice(0, separator) : value;
  const inlineVersion = hasVersion ? value.slice(separator + 1) : undefined;
  if (hasVersion && !inlineVersion) throw new SkillFluxError('INVALID_ARGUMENTS', `Skill version is empty: ${value}`);
  if (inlineVersion && versionOption && inlineVersion !== versionOption) {
    throw new SkillFluxError('INVALID_ARGUMENTS', `Conflicting skill versions: ${inlineVersion} and ${versionOption}`);
  }
  return { id, version: inlineVersion ?? versionOption };
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

async function compiledCliPath(): Promise<string> {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith('.js')) return current;
  const compiled = join(packageRoot(), 'dist', 'cli.js');
  const info = await stat(compiled).catch(() => null);
  if (!info?.isFile()) throw new SkillFluxError('BUILD_REQUIRED', `Build the package before init so MCP can register a real executable: ${compiled}`);
  return compiled;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): string {
  return `SkillFlux — anonymous reviewed skill search, local loading and disclosed sponsored output

Usage:
  skillflux registry [--dev] [--host HOST] [--port PORT] [--data-dir PATH]
  skillflux init --project PATH --registry URL --host codex|claude|cursor|generic [--preauthorize-reviewed-text]
  skillflux serve --project PATH
  skillflux search [QUERY...] [--project PATH] [--category CATEGORY]
  skillflux plan SKILL_ID [--version VERSION] [--project PATH]
  skillflux install SKILL_ID|PLAN_ID [--version VERSION] [--project PATH]
  skillflux load SKILL_ID [--resource PATH] [--project PATH]
  skillflux list [--project PATH]
  skillflux check-updates [SKILL_ID] [--cached] [--project PATH]
  skillflux pin|unpin SKILL_ID [--project PATH]
  skillflux update [SKILL_ID@VERSION] [--plan PLAN_ID] [--yes] [--project PATH]
  skillflux rollback [SKILL_ID] [--project PATH]
  skillflux remove SKILL_ID [--force] [--project PATH]
  skillflux privacy [status|reset|ads-on|ads-off] [--reset-trust] [--project PATH]
  skillflux backup --data-dir DIR --dest DIR
  skillflux backup --check --backup DIR [--data-dir DIR | --key-id KEY_ID]
  skillflux backup --restore --backup DIR --dest DIR [--data-dir DIR | --key-id KEY_ID]
  skillflux run --project PATH --skill SKILL_ID [--resource PATH] [--category CATEGORY] [--ad-context normal|sensitive|unknown] [--json] -- EXECUTABLE ARG...

Managed run never invokes a shell. It supplies verified context through SKILLFLUX_CONTEXT_FILE and appends a disclosed advertisement only after successful, non-empty text output.
`;
}

if (isInvokedAsEntry()) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    const code = error instanceof SkillFluxError ? error.code : 'INTERNAL_ERROR';
    process.stderr.write(`${code}: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

function isInvokedAsEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}
