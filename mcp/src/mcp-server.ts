import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Host } from './shared.js';
import { SkillFluxError } from './runtime/errors.js';
import { SkillFluxRuntime } from './runtime/runtime.js';
import { RUNTIME_VERSION } from './runtime/updates.js';

const hostSchema = z.enum(['generic', 'codex', 'claude', 'cursor']);
const sortSchema = z.enum(['relevance', 'newest', 'name']);

export function createSkillFluxMcpServer(runtime: SkillFluxRuntime): McpServer {
  const server = new McpServer({ name: 'skillflux', version: RUNTIME_VERSION });

  server.registerTool('skillflux.search', {
    title: 'Search the curated SkillFlux catalog',
    description: 'Search the curated SkillFlux skill marketplace (a reviewed GitHub-hosted catalog) using a short capability description. Search runs locally over a cached catalog index. Do not include source, secrets, full prompts or personal data.',
    inputSchema: {
      query: z.string().max(500).optional().default(''),
      category: z.string().max(80).optional(),
      host: hostSchema.optional(),
      sort: sortSchema.optional().default('relevance'),
      limit: z.number().int().min(1).max(50).optional().default(12),
      offset: z.number().int().min(0).optional().default(0),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async args => toolResult(async () => {
    const result = await runtime.search({ ...args, host: args.host as Host | undefined });
    return {
      value: result,
      text: result.items.length
        ? result.items.map(item => `${item.id}@${item.version} — ${item.name}: ${item.description}`).join('\n')
        : 'No approved SkillFlux skill matched this capability query.',
    };
  }));

  server.registerTool('skillflux.plan', {
    title: 'Create a sealed installation plan',
    description: 'Resolve one approved catalog skill and its exact dependencies into a short-lived plan bound to this project, catalog repository and host.',
    inputSchema: {
      skillId: z.string().min(1).max(96),
      version: z.string().max(128).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async args => toolResult(async () => {
    const plan = await runtime.createPlan(args.skillId, { version: args.version });
    return {
      value: plan,
      text: `Plan ${plan.id} resolves ${plan.rootSkillId}@${plan.rootSkillVersion} with ${plan.packages.length} reviewed text package(s). It expires at ${plan.expiresAt}.` + (plan.intent === 'update' ? `\nReview these exact changes and obtain explicit user authorization before calling skillflux.update with this planId:\n${plan.changes!.map(change => `${change.id}: ${change.from} → ${change.to}${change.breaking ? ' [BREAKING]' : ''}: ${change.notes}`).join('\n')}` : ''),
    };
  }));

  server.registerTool('skillflux.install', {
    title: 'Install a sealed SkillFlux plan',
    description: 'Install only a Runtime-generated plan id. Each file is downloaded from a pinned catalog commit and verified against its sha256. MCP installation works only when reviewed text packages were explicitly preauthorized during local init.',
    inputSchema: { planId: z.string().min(20).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async args => toolResult(async () => {
    const result = await runtime.installPlan(args.planId, 'mcp');
    return { value: result, text: `Installed ${result.rootSkill.id}@${result.rootSkill.version}; project lock revision is ${result.lockRevision}.` };
  }));

  server.registerTool('skillflux.load', {
    title: 'Load a verified skill into this turn',
    description: 'Reverify an installed package, check the current catalog for revocations, and return its complete main entry plus explicitly requested resources for immediate use.',
    inputSchema: {
      skillId: z.string().min(1).max(96),
      resources: z.array(z.string().min(1).max(240)).max(32).optional().default([]),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async args => toolResult(async () => {
    const loaded = await runtime.load(args.skillId, args.resources);
    return { value: loaded, text: renderLoadedSkill(loaded) };
  }));

  server.registerTool('skillflux.list', {
    title: 'List installed project skills',
    description: 'List the exact SkillFlux versions selected by the current project lock.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  }, async () => toolResult(async () => {
    const result = await runtime.list();
    return {
      value: result,
      text: result.skills.length ? result.skills.map(item => `${item.id}@${item.version}${item.direct ? ' (direct)' : ' (dependency)'}`).join('\n') : 'No SkillFlux skills are installed in this project.',
    };
  }));

  server.registerTool('skillflux.check_updates', {
    title: 'Check installed skill updates without installing',
    description: 'Read current and available versions, change notes, compatibility, pins and revocations from the catalog index. Cached checks have a 24-hour lifetime. Offline or failed checks report unknown and their cache source. Never installs or changes a version.',
    inputSchema: { skillId: z.string().min(1).max(96).optional(), force: z.boolean().optional().default(true) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async args => toolResult(async () => {
    const result = await runtime.checkUpdates(args.skillId, args.force);
    return { value: result, text: JSON.stringify(result, null, 2) };
  }));

  server.registerTool('skillflux.pin', {
    title: 'Pin or unpin the installed version',
    description: 'Explicitly change the local fixed-version policy. A pinned version blocks all updates and rollback version changes until the user asks to unpin it.',
    inputSchema: { skillId: z.string().min(1).max(96), pinned: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async args => toolResult(async () => {
    const result = await runtime.setPinned(args.skillId, args.pinned);
    return { value: result, text: `${result.id}@${result.version} is ${result.pinned ? 'pinned' : 'unpinned'}.` };
  }));

  server.registerTool('skillflux.update', {
    title: 'Execute an explicitly authorized fixed update plan',
    description: 'Call only after the user explicitly approves the exact versions and breaking changes in a skillflux.plan result. Requires that planId; initial reviewed-text preauthorization does not authorize arbitrary upgrades. Does not resolve latest versions. Local edits, pins, stale plans and revoked targets block execution.',
    inputSchema: { planId: z.string().min(20).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async args => toolResult(async () => {
    const result = await runtime.installUpdatePlan(args.planId, 'mcp');
    return { value: result, text: `Updated ${result.rootSkill.id}@${result.rootSkill.version}; project lock revision is ${result.lockRevision}.` };
  }));

  server.registerTool('skillflux.rollback', {
    title: 'Roll back the project skill lock',
    description: 'Restore a previous verified, non-revoked lock state. This is available to MCP only under the project local preauthorization policy.',
    inputSchema: { skillId: z.string().min(1).max(96).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async args => toolResult(async () => {
    const result = await runtime.rollback(args.skillId, 'mcp');
    return { value: result, text: `Restored project lock revision ${result.revision}.` };
  }));

  server.registerTool('skillflux.remove', {
    title: 'Remove an installed project skill',
    description: 'Remove one project skill and orphaned dependencies. Locally edited files are always preserved for MCP callers.',
    inputSchema: { skillId: z.string().min(1).max(96) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async args => toolResult(async () => {
    const result = await runtime.remove(args.skillId, { actor: 'mcp', force: false });
    return { value: result, text: `Removed ${result.removed.join(', ')}; project lock revision is ${result.lockRevision}.` };
  }));

  server.registerTool('skillflux.privacy', {
    title: 'Inspect local anonymous privacy state',
    description: 'Read-only view of anonymous local state: what the catalog client sends and never sends. Search queries never leave this machine; only the catalog repository name is used.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => toolResult(async () => {
    const result = await runtime.privacyState();
    return { value: result, text: JSON.stringify(result, null, 2) };
  }));

  return server;
}

export async function serveSkillFluxStdio(projectRoot: string): Promise<void> {
  const runtime = await SkillFluxRuntime.open(projectRoot);
  const server = createSkillFluxMcpServer(runtime);
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 2 * 1024 * 1024 });
  await server.connect(transport);
}

function renderLoadedSkill(loaded: Awaited<ReturnType<SkillFluxRuntime['load']>>): string {
  const output = [
    `Verified SkillFlux skill ${loaded.skill.id}@${loaded.skill.version}`,
    `Publisher: ${loaded.skill.publisher}`,
    `Digest: ${loaded.skill.digest}`,
    '',
    `# Main entry: ${loaded.entry.path}`,
    '',
    loaded.entry.content,
  ];
  for (const dependency of loaded.dependencies) output.push('', `# Dependency: ${dependency.id}@${dependency.version} (${dependency.entry})`, '', dependency.content);
  for (const [path, content] of Object.entries(loaded.resources)) output.push('', `# Requested resource: ${path}`, '', content);
  if (loaded.warnings.length) output.push('', '# Runtime warnings', ...loaded.warnings.map(warning => `- ${warning}`));
  if (loaded.update && loaded.update.status !== 'current') output.push('', `Runtime update notice: ${loaded.update.id}@${loaded.update.currentVersion}; status=${loaded.update.status}; latest compatible=${loaded.update.latestCompatibleVersion ?? 'unknown'}; pinned=${loaded.update.pinned}; checked=${loaded.update.checkedAt ?? 'never'}; source=${loaded.update.source}. Check updates and ask the user before changing versions.`);
  return output.join('\n');
}

async function toolResult(operation: () => Promise<{ value: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { value, text } = await operation();
    return { content: [{ type: 'text', text }], structuredContent: asStructuredContent(value) };
  } catch (error) {
    const code = error instanceof SkillFluxError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text', text: `${code}: ${message}` }],
      structuredContent: { error: { code, message } },
    };
  }
}

function asStructuredContent(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}
