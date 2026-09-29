import { readFile, mkdir, rename, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyPayload, type Signed, type PublicKeyInfo } from '../../mcp/src/shared';
import { normalizeRegistryUrl } from '../../mcp/src/runtime/api-client';
import { validatePublication, type PublicationPage, type PublicationStatusPage, type PublicationSnapshot } from '../src/lib/publication';

const MAX_PAGE_BYTES = 8 * 1024 * 1024;
export async function fetchPublicationJson<T>(registry: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, `${registry}/`), { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Publication request failed: HTTP ${response.status} at ${path}`);
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) throw new Error('Publication response must be JSON');
  if (!response.body) throw new Error('Empty publication response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_PAGE_BYTES) { await reader.cancel(); throw new Error('Publication page exceeds 8 MiB'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

export async function synchronizePublication(options: { registry: string; output: string; trustedKey?: PublicKeyInfo; acceptFirstKey?: boolean }): Promise<PublicationSnapshot> {
  const registry = normalizeRegistryUrl(options.registry);
  let previous: PublicationSnapshot | undefined;
  try { previous = JSON.parse(await readFile(options.output, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous) validatePublication(previous);
  const remoteKey = await fetchPublicationJson<PublicKeyInfo>(registry, '/v1/keys');
  const trusted = options.trustedKey ?? (previous?.registry === registry ? previous.key ?? undefined : undefined);
  if (trusted && (trusted.keyId !== remoteKey.keyId || trusted.publicKey !== remoteKey.publicKey)) throw new Error('Registry signing key changed; explicit trust migration is required');
  if (!trusted && !options.acceptFirstKey) throw new Error('First sync needs --trust-key PATH (JSON public key) or explicit --accept-first-key TOFU consent');
  const key = trusted ?? remoteKey;
  const pages: Signed<PublicationPage>[] = [];
  const statusPages: Signed<PublicationStatusPage>[] = [];
  let offset = 0, total = 0, revision = '';
  do {
    const envelope = await fetchPublicationJson<Signed<PublicationPage>>(registry, `/v1/publication?offset=${offset}&limit=10`);
    const page = verifyPayload(envelope, key);
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 10000 || page.offset !== offset || !Array.isArray(page.items)
      || Date.parse(page.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(page.expiresAt))) throw new Error('Invalid or expired publication page');
    if (pages.length && (page.revision !== revision || page.total !== total)) throw new Error('Registry changed during sync; retry without publishing this snapshot');
    total = page.total; revision = page.revision;
    if (!page.items.length && offset < total) throw new Error('Publication pagination did not advance');
    pages.push(envelope); offset += page.items.length;
  } while (offset < total);
  offset = 0;
  do {
    const envelope = await fetchPublicationJson<Signed<PublicationStatusPage>>(registry, `/v1/publication/statuses?offset=${offset}&limit=100`);
    const page = verifyPayload(envelope, key);
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.total > 10000 || page.offset !== offset || !Array.isArray(page.items)
      || page.revision !== revision || !Number.isFinite(Date.parse(page.expiresAt)) || Date.parse(page.expiresAt) <= Date.now()) throw new Error('Invalid, expired or changed publication statuses');
    total = page.total;
    if (!page.items.length && offset < total) throw new Error('Status pagination did not advance');
    statusPages.push(envelope); offset += page.items.length;
  } while (offset < total);
  const snapshot: PublicationSnapshot = { schema: 'skillflux-publication/v1', registry, fetchedAt: new Date().toISOString(), key, pages, statusPages };
  validatePublication(snapshot);
  await mkdir(dirname(options.output), { recursive: true });
  const stat = await lstat(options.output).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat?.isSymbolicLink()) throw new Error('Refusing to replace a symlinked publication output');
  const staged = `${options.output}.${randomUUID()}.tmp`;
  await writeFile(staged, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  await rename(staged, options.output);
  return snapshot;
}

async function main(): Promise<void> {
  const parsed = parseArgs({ options: { registry: { type: 'string' }, output: { type: 'string' }, 'trust-key': { type: 'string' }, 'accept-first-key': { type: 'boolean', default: false }, help: { type: 'boolean', default: false } } });
  if (parsed.values.help) {
    process.stdout.write('Sync a verified static catalog: npm run publication:sync --workspace @skillflux/web -- --registry URL [--trust-key key.json | --accept-first-key] [--output PATH]\nExisting snapshots pin their signing key. Failed syncs never replace them.\n');
    return;
  }
  const registry = parsed.values.registry ?? process.env.SKILLFLUX_REGISTRY_URL ?? process.env.PUBLIC_REGISTRY_URL;
  if (!registry) throw new Error('Set --registry or SKILLFLUX_REGISTRY_URL. The directory can build without a registry; curated publication cannot sync without one.');
  const output = resolve(parsed.values.output ?? process.env.SKILLFLUX_PUBLICATION_PATH ?? fileURLToPath(new URL('../data/registry-publication.json', import.meta.url)));
  const keyPath = parsed.values['trust-key'] ?? process.env.SKILLFLUX_PUBLICATION_KEY;
  const trustedKey = keyPath ? JSON.parse(await readFile(keyPath, 'utf8')) as PublicKeyInfo : undefined;
  const snapshot = await synchronizePublication({ registry, output, trustedKey, acceptFirstKey: parsed.values['accept-first-key'] });
  process.stdout.write(`Verified ${snapshot.pages.reduce((sum, page) => sum + page.payload.items.length, 0)} curated versions from ${snapshot.registry}; snapshot: ${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
