import { build } from 'esbuild';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGoneRoutes, getLegacyRedirects } from '../src/lib/seo-routes';

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
      }
    }
  }
  await scan(dist);
  // An article written only in Chinese has no English URL. Send the English
  // address (and the retired /en/ one) to the version that exists.
  const routes = new Set(pages);
  for (const route of pages) {
    const match = /^\/zh(\/insights\/[^/]+\/)$/.exec(route);
    if (match && !routes.has(match[1]!)) {
      redirects[match[1]!] = route;
      redirects[`/en${match[1]}`] = route;
    }
  }
  const sorted = Object.entries(redirects).sort(([a], [b]) => a.localeCompare(b));
  await writeFile(resolve(dist, '.assetsignore'), '_worker.js\n');
  await build({
    entryPoints: [resolve(webRoot, 'edge/worker.ts')],
    outfile: resolve(dist, '_worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    define: { __SEO_REDIRECTS__: JSON.stringify(redirects), __SEO_PAGES__: JSON.stringify(pages), __SEO_GONE__: JSON.stringify(getGoneRoutes()) },
    minify: true
  });
  console.log(`Generated HTTP redirects (${sorted.length}) and edge indexing rules.`);
}
