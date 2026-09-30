import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createRegistryServer } from '../../mcp/src/registry/server';
import { publishSyntheticFixture, syntheticRelease } from '../../mcp/tests/registry-fixture';
import { buildPublication } from './publication-build';

// Synthetic evaluation inputs simulate an operator workflow only in a disposable database.
// Neither the source snapshot nor production registry data is modified by this test harness.
const directory = await mkdtemp(join(tmpdir(), 'skillflux-browser-fixture-'));
const token = 'disposable-browser-fixture-operator';
const registry = await createRegistryServer({ dataDir: join(directory, 'registry'), adminToken: token });
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let site: ReturnType<typeof createServer> | undefined;
try {
  await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve));
  const registryUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}`;
  for (let index = 0; index < 14; index++) {
    const id = `browser-fixture-${String(index).padStart(2, '0')}`;
    await publishSyntheticFixture(registryUrl, token, {
      id, version: '1.0.0', name: index === 0 ? 'Literal </script><script>window.__skillflux_xss=1</script>' : `Synthetic browser fixture ${index}`,
      description: 'Isolated automated browser fixture; not a real human-tested production release.',
      category: index % 2 === 0 ? 'engineering' : 'research', tags: ['synthetic', 'browser'],
      hosts: ['generic'], publisher: 'Automated isolated test', license: 'MIT', entry: 'SKILL.md',
      permissions: { network: [], shell: false, secrets: [] }, dependencies: [], release: syntheticRelease,
      files: { 'SKILL.md': `# ${id}\n\nThis is an isolated browser test fixture, not a production skill or a claim of actual human evaluation. Ask for the task input, inspect only the supplied text, and return a summary of its supported statements. Report missing evidence and stay within the requested scope.`, 'references/example.md': '# Literal resource\n\n<em>Resource text is displayed literally, never executed.</em>' },
    });
  }
  const release = await buildPublication({ registry: registryUrl, output: join(directory, 'current'), acceptFirstKey: true });
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png' };
  site = createServer((request, response) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      let path = resolve(release.dist, `.${pathname}`);
      if (relative(release.dist, path).startsWith('..')) { response.writeHead(403).end(); return; }
      try {
        if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
        const body = await readFile(path);
        response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' }); response.end(body);
      } catch { response.writeHead(404).end('Not found'); }
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>(resolve => site!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  const result = await promisify(execFile)('python3', ['-u', join(webRoot, 'scripts/public-ui-check.py'), '--base', base, '--output', '/tmp/skillflux-public-populated', '--channel', process.env.SKILLFLUX_BROWSER_CHANNEL ?? 'chrome'], { cwd: webRoot, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} finally {
  if (site) await new Promise<void>(resolve => site!.close(() => resolve()));
  await new Promise<void>(resolve => registry.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
