import { build } from 'esbuild';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLegacyRedirects } from '../src/lib/seo-routes';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildDeployment(outDir: string): Promise<void> {
  const dist = resolve(outDir);
  const redirects = getLegacyRedirects();
  const pages: string[] = [];
  async function scan(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith('.html')) {
        const html = await readFile(path, 'utf8');
        if (/http-equiv=["']refresh["']/i.test(html)) continue;
        const route = `/${relative(dist, path).replace(/\\/g, '/').replace(/index\.html$/, '')}`;
        pages.push(route);
        if (/^\/insights\/[^/]+\/$/.test(route)) redirects[`/en${route}`] = route;
      }
    }
  }
  await scan(dist);
  const sorted = Object.entries(redirects).sort(([a], [b]) => a.localeCompare(b));
  await writeFile(resolve(dist, '.assetsignore'), '_worker.js\n');
  await build({
    entryPoints: [resolve(webRoot, 'edge/worker.ts')],
    outfile: resolve(dist, '_worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    define: { __SEO_REDIRECTS__: JSON.stringify(redirects), __SEO_PAGES__: JSON.stringify(pages) },
    minify: true
  });
  console.log(`Generated HTTP redirects (${sorted.length}) and edge indexing rules.`);
}
