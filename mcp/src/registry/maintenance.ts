import { createHash, createPublicKey } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { sha256, signPayload, verifyPayload, type Signed } from '../shared.js';

const DATABASE = 'registry.sqlite';
const PRIVATE_KEY = 'keys/registry-ed25519-private.pem';
const PUBLIC_KEY = 'keys/registry-ed25519-public.pem';
const FILES = [DATABASE, PRIVATE_KEY, PUBLIC_KEY] as const;
interface BackupManifest {
  schema: 'skillflux-backup/v1'; createdAt: string; keyId: string; schemaVersion: number;
  files: { path: string; sha256: string; size: number }[];
}
export interface BackupCheck { valid: true; directory: string; keyId: string; schemaVersion: number; createdAt: string; files: number }

async function regularFile(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular, non-symlink file: ${path}`);
  return info.size;
}
async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function keysAt(directory: string) {
  await Promise.all([regularFile(join(directory, PRIVATE_KEY)), regularFile(join(directory, PUBLIC_KEY))]);
  const [privateKey, publicKey] = await Promise.all([readFile(join(directory, PRIVATE_KEY), 'utf8'), readFile(join(directory, PUBLIC_KEY), 'utf8')]);
  const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (derived !== publicKey) throw new Error('Backup signing keys do not match');
  return { privateKey, publicKey, keyId: `ed25519:${sha256(publicKey).slice(0, 24)}` };
}
function inspectDatabase(path: string): number {
  const database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('SQLite foreign key check failed');
    const version = Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version < 0 || version > 2) throw new Error('Unsupported registry schema version in backup');
    for (const table of ['skills', 'campaigns', 'ad_decisions', 'events', 'ledger', 'audit_log']) {
      if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Backup is missing registry table ${table}`);
    }
    const amounts = database.prepare('SELECT COUNT(*) AS count FROM campaigns WHERE spent_cents < 0 OR reserved_cents < 0 OR spent_cents + reserved_cents > budget_cents').get() as { count: number };
    if (Number(amounts.count)) throw new Error('Backup has inconsistent campaign accounting');
    return version;
  } finally { database.close(); }
}

/** Derives the signing identity of an existing registry data directory so a backup can be checked against the live installation. */
export async function registryKeyId(dataDir: string): Promise<string> {
  return (await keysAt(resolve(dataDir))).keyId;
}

/** Creates a consistent online SQLite snapshot, including committed WAL data and the unchanged signing identity. */
export async function backupRegistry(dataDir: string, destination: string): Promise<BackupCheck> {
  const source = resolve(dataDir), target = resolve(destination);
  await regularFile(join(source, DATABASE));
  const keys = await keysAt(source);
  await mkdir(target, { mode: 0o700 }); // Exclusive: existing directories are never overwritten.
  await mkdir(join(target, 'keys'), { mode: 0o700 });
  const database = new DatabaseSync(join(source, DATABASE), { readOnly: true, allowExtension: false });
  try { database.prepare('VACUUM INTO ?').run(join(target, DATABASE)); } finally { database.close(); }
  await chmod(join(target, DATABASE), 0o600);
  for (const path of [PRIVATE_KEY, PUBLIC_KEY]) {
    await copyFile(join(source, path), join(target, path), constants.COPYFILE_EXCL);
    await chmod(join(target, path), 0o600);
  }
  const copiedKeys = await keysAt(target);
  if (copiedKeys.keyId !== keys.keyId || copiedKeys.privateKey !== keys.privateKey) throw new Error('Signing identity changed during backup; discard this incomplete snapshot');
  const schemaVersion = inspectDatabase(join(target, DATABASE));
  const files = await Promise.all(FILES.map(async path => ({ path, size: await regularFile(join(target, path)), sha256: await fileHash(join(target, path)) })));
  const manifest: BackupManifest = { schema: 'skillflux-backup/v1', createdAt: new Date().toISOString(), keyId: keys.keyId, schemaVersion, files };
  await writeFile(join(target, 'backup.json'), JSON.stringify(signPayload(manifest, keys.privateKey, keys.keyId), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return checkRegistryBackup(target, keys.keyId);
}

/** expectedKeyId should be supplied from the operator's existing trust configuration when restoring an external backup. */
export async function checkRegistryBackup(directory: string, expectedKeyId?: string): Promise<BackupCheck> {
  const target = resolve(directory);
  const manifestPath = join(target, 'backup.json');
  if (await regularFile(manifestPath) > 64 * 1024) throw new Error('Backup manifest is too large');
  const envelope = JSON.parse(await readFile(manifestPath, 'utf8')) as Signed<BackupManifest>;
  const keys = await keysAt(target);
  if (expectedKeyId && expectedKeyId !== keys.keyId) throw new Error('Backup signing identity does not match the expected registry key');
  const manifest = verifyPayload(envelope, keys);
  if (manifest.schema !== 'skillflux-backup/v1' || manifest.keyId !== keys.keyId || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.files) || manifest.files.length !== FILES.length) throw new Error('Invalid backup manifest');
  for (const path of FILES) {
    const entries = manifest.files.filter(item => item.path === path);
    if (entries.length !== 1) throw new Error(`Backup manifest must describe ${path} exactly once`);
    const entry = entries[0]!;
    if (await regularFile(join(target, path)) !== entry.size || await fileHash(join(target, path)) !== entry.sha256) throw new Error(`Backup integrity mismatch: ${path}`);
  }
  const schemaVersion = inspectDatabase(join(target, DATABASE));
  if (schemaVersion !== manifest.schemaVersion) throw new Error('Backup schema version does not match signed manifest');
  return { valid: true, directory: target, keyId: keys.keyId, schemaVersion, createdAt: manifest.createdAt, files: FILES.length };
}

/** Restores only to a new directory; callers switch the stopped service to this path after verification. */
export async function restoreRegistryBackup(backupDirectory: string, destination: string, expectedKeyId?: string): Promise<BackupCheck> {
  const source = resolve(backupDirectory), target = resolve(destination);
  const checked = await checkRegistryBackup(source, expectedKeyId);
  await mkdir(target, { mode: 0o700 });
  await mkdir(join(target, 'keys'), { mode: 0o700 });
  for (const path of [...FILES, 'backup.json']) {
    await copyFile(join(source, path), join(target, path), constants.COPYFILE_EXCL);
    await chmod(join(target, path), 0o600);
  }
  return checkRegistryBackup(target, checked.keyId);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, targetOrKey, expectedKeyId] = process.argv.slice(2);
  try {
    if (!source) throw new Error('Usage: maintenance.js backup DATA_DIR NEW_BACKUP_DIR | check BACKUP_DIR [EXPECTED_KEY_ID] | restore BACKUP_DIR NEW_DATA_DIR [EXPECTED_KEY_ID]');
    let result: BackupCheck;
    if (command === 'backup' && targetOrKey) result = await backupRegistry(source, targetOrKey);
    else if (command === 'check') result = await checkRegistryBackup(source, targetOrKey);
    else if (command === 'restore' && targetOrKey) result = await restoreRegistryBackup(source, targetOrKey, expectedKeyId);
    else throw new Error('Unknown maintenance operation or missing destination');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { process.stderr.write((error instanceof Error ? error.message : 'Maintenance failed') + '\n'); process.exitCode = 1; }
}
