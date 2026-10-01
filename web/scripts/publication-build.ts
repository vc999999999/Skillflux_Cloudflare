import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, lstat, mkdir, mkdtemp, readdir, rename, symlink, unlink, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { validatePublication, type PublicationSnapshot } from '../src/lib/publication';
import { synchronizePublication } from './sync-publication';
import { finalizeBuild } from './seo-build';

const execute = promisify(execFile);
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASTRO_CLI = fileURLToPath(new URL('../../node_modules/astro/bin/astro.mjs', import.meta.url));
export interface PublicationBuildOptions { repo: string; output?: string; source?: string; branch?: string; force?: boolean; webRoot?: string }
export interface PublicationBuildResult { changed: boolean; commitSha: string; current: string; dist: string; snapshot: string; versions: number }

async function optionalStat(path: string) { return lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; }); }
async function lockBuild(path: string): Promise<() => Promise<void>> {
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await writeFile(path, JSON.stringify({ nonce, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
      return async () => { const owner = JSON.parse(await readFile(path, 'utf8')); if (owner.nonce === nonce) await unlink(path); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = await optionalStat(path);
      if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Publication build lock is not a regular file');
      if (Date.now() - info.mtimeMs > 10 * 60_000) {
        // Break stale locks purely by age: PID probing misfires when PIDs get reused.
        await unlink(path).catch(error2 => { if ((error2 as NodeJS.ErrnoException).code !== 'ENOENT') throw error2; });
        continue;
      }
      throw new Error('Publication build is already running (a fresh lock exists)');
    }
  }
  throw new Error('Could not acquire publication build lock');
}

/** Keep the newest N release directories; watch mode otherwise grows one per commit forever. */
const RELEASE_RETENTION = 10;

async function pruneReleases(releases: string): Promise<void> {
  const entries = (await readdir(releases).catch(() => [])).filter(name => !name.startsWith('.')).sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - RELEASE_RETENTION))) {
    await rm(join(releases, stale), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The served pointer changes once, after both the verified snapshot and full static build succeed. */
export async function buildPublication(options: PublicationBuildOptions): Promise<PublicationBuildResult> {
  const webRoot = resolve(options.webRoot ?? WEB_ROOT);
  const current = resolve(options.output ?? join(WEB_ROOT, '.publication/current'));
  await mkdir(dirname(current), { recursive: true });
  const unlock = await lockBuild(`${current}.lock`);
  let staged: string | undefined;
  let temporaryLink: string | undefined;
  try {
    const currentInfo = await optionalStat(current);
    if (currentInfo && !currentInfo.isSymbolicLink()) throw new Error('Publication output already exists as a real directory or file. Choose a new pointer path; existing output is preserved.');
    let previous: PublicationSnapshot | undefined;
    if (currentInfo) {
      previous = JSON.parse(await readFile(join(current, 'registry-publication.json'), 'utf8')) as PublicationSnapshot;
      validatePublication(previous);
    }
    const releases = join(dirname(current), `${basename(current)}-releases`);
    await mkdir(releases, { recursive: true });
    staged = await mkdtemp(join(releases, '.stage-'));
    const snapshotPath = join(staged, 'registry-publication.json');
    // Copy the previous snapshot only to the isolated stage, retaining the pinned repository identity.
    if (previous) await writeFile(snapshotPath, JSON.stringify(previous), { flag: 'wx', mode: 0o600 });
    const snapshot = await synchronizePublication({ repo: options.repo, output: snapshotPath, ...(options.source ? { source: options.source } : {}), ...(options.branch ? { branch: options.branch } : {}) });
    const publication = validatePublication(snapshot);
    const commitSha = snapshot.commitSha!;
    const result = { commitSha, current, dist: join(current, 'dist'), snapshot: join(current, 'registry-publication.json'), versions: publication.items.length };
    if (!options.force && previous?.commitSha === commitSha) return { ...result, changed: false };
    const dist = join(staged, 'dist');
    await execute(process.execPath, [ASTRO_CLI, 'build', '--outDir', dist], {
      cwd: webRoot, timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, SKILLFLUX_PUBLICATION_PATH: snapshotPath, SKILLFLUX_CATALOG_REPO: snapshot.repo! },
    });
    await finalizeBuild(dist);
    const index = await readFile(join(dist, 'index.html'), 'utf8');
    if (!index.includes('<html') || index.length < 200) throw new Error('Static build did not produce a complete home page');
    JSON.parse(await readFile(join(dist, 'index.json'), 'utf8'));
    await readFile(join(dist, 'llms.txt'), 'utf8');
    await writeFile(join(staged, 'publication-build.json'), JSON.stringify({ schema: 'skillflux-static-release/v2', commitSha, builtAt: new Date().toISOString(), repo: snapshot.repo, versions: publication.items.length }, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
    const release = join(releases, `${commitSha.slice(0, 16)}-${randomUUID()}`);
    await rename(staged, release); staged = undefined;
    temporaryLink = `${current}.${randomUUID()}.next`;
    await symlink(relative(dirname(current), release), temporaryLink, 'dir');
    await rename(temporaryLink, current); temporaryLink = undefined;
    await pruneReleases(releases);
    return { ...result, changed: true };
  } finally {
    if (temporaryLink) await unlink(temporaryLink).catch(() => {});
    if (staged) await rm(staged, { recursive: true, force: true });
    await unlock();
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({ options: { repo: { type: 'string' }, source: { type: 'string' }, branch: { type: 'string' }, output: { type: 'string' }, force: { type: 'boolean', default: false }, watch: { type: 'boolean', default: false }, interval: { type: 'string', default: '60' }, help: { type: 'boolean', default: false } } });
  if (parsed.values.help) { process.stdout.write('publication:build --repo OWNER/NAME [--source URL] [--output CURRENT_POINTER] [--force]\npublication:watch uses the same options plus --interval SECONDS (minimum 5). Serve CURRENT_POINTER/dist. Each successful release atomically switches snapshot and dist together; failed builds preserve the previous release.\n'); return; }
  const repo = parsed.values.repo ?? process.env.SKILLFLUX_CATALOG_REPO;
  if (!repo) throw new Error('Set --repo or SKILLFLUX_CATALOG_REPO');
  const options: PublicationBuildOptions = { repo, output: parsed.values.output ?? process.env.SKILLFLUX_PUBLICATION_OUTPUT, source: parsed.values.source, branch: parsed.values.branch, force: parsed.values.force };
  const interval = Number(parsed.values.interval);
  if (!Number.isFinite(interval) || interval < 5 || interval > 86400) throw new Error('Watch interval must be between 5 and 86400 seconds');
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  do {
    try { const result = await buildPublication(options); if (result.changed || !parsed.values.watch) process.stdout.write(JSON.stringify(result) + '\n'); }
    catch (error) { if (!parsed.values.watch) throw error; process.stderr.write(`Publication attempt failed; current release preserved, retrying: ${(error as Error).message}\n`); }
    if (!parsed.values.watch || stopped) break;
    // Short waits allow signals to stop the watcher promptly.
    for (let elapsed = 0; elapsed < interval * 1000 && !stopped; elapsed += 1000) await new Promise(resolve => setTimeout(resolve, Math.min(1000, interval * 1000 - elapsed)));
  } while (!stopped);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
