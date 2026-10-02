import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeHTML } from 'entities';
import { ELEMENT_NODE, TEXT_NODE, parse, walkSync, type ElementNode, type Node } from 'ultrahtml';

export type BuiltPage = {
  file: string;
  path: string;
  language: string;
  title: string;
  description: string;
  canonical: string;
  indexable: boolean;
  redirect: boolean;
  alternates: Array<{ language: string; href: string }>;
  links: string[];
  lastmod?: string;
  issues: string[];
};

export const SITEMAP_GROUPS = ['resources', 'guides', 'agents', 'static', 'tags'] as const;
type SitemapGroup = typeof SITEMAP_GROUPS[number];
type SitemapFiles = Record<string, string>;
const RESOURCE_SECTIONS = ['best-for', 'use-cases', 'notes', 'limitations', 'alternatives'];
const RESOURCE_FIELDS = ['resource-type', 'source-type', 'source-url'];
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

function textContent(node: Node, includeScripts = false): string {
  if (node.type === TEXT_NODE) return decodeHTML(node.value);
  if (node.type === ELEMENT_NODE && (!includeScripts && ['script', 'style', 'template'].includes(node.name) || 'hidden' in node.attributes)) return '';
  return 'children' in node ? node.children.map((child: Node) => textContent(child, includeScripts)).join(' ') : '';
}
function compact(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function elements(node: Node): ElementNode[] {
  const result: ElementNode[] = [];
  walkSync(node, item => { if (item.type === ELEMENT_NODE) result.push(item); });
  return result;
}
function attribute(node: ElementNode, name: string): string { return decodeHTML(node.attributes[name] ?? ''); }
function hasRel(node: ElementNode, rel: string): boolean { return attribute(node, 'rel').toLowerCase().split(/\s+/).includes(rel); }
function pagePath(file: string): string {
  const normalized = `/${file.replaceAll('\\', '/')}`;
  return normalized.endsWith('/index.html') ? normalized.slice(0, -10) : normalized;
}
function schemaObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(schemaObjects);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [record, ...schemaObjects(record['@graph'])];
}
function schemaHasType(value: Record<string, unknown>, type: string): boolean {
  const types = value['@type'];
  return Array.isArray(types) ? types.includes(type) : types === type;
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const time = Date.parse(value);
  const calendarDay = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(time) && Number.isFinite(calendarDay) && new Date(calendarDay).toISOString().slice(0, 10) === value.slice(0, 10);
}

/** Parse the generated response, never the Astro template or hydrated DOM. */
export function inspectHtml(file: string, html: string): BuiltPage {
  const document = parse(html) as Node;
  const all = elements(document);
  const select = (name: string) => all.filter(node => node.name.toLowerCase() === name);
  const meta = (name: string) => select('meta').filter(node => attribute(node, 'name').toLowerCase() === name);
  const canonicalNodes = select('link').filter(node => hasRel(node, 'canonical'));
  const canonical = canonicalNodes[0] ? attribute(canonicalNodes[0], 'href') : '';
  const robots = meta('robots').map(node => attribute(node, 'content')).join(',').toLowerCase();
  const redirect = select('meta').some(node => attribute(node, 'http-equiv').toLowerCase() === 'refresh');
  const indexable = !redirect && !/\b(?:noindex|none)\b/.test(robots);
  const issues: string[] = [];
  const titles = select('title');
  const descriptions = meta('description');
  const title = compact(titles[0] ? textContent(titles[0]) : '');
  const description = compact(descriptions[0] ? attribute(descriptions[0], 'content') : '');
  const path = pagePath(file);
  const language = select('html')[0] ? attribute(select('html')[0]!, 'lang').toLowerCase() : '';
  const mains = select('main');
  const mainElements = mains.flatMap(elements);
  const mainText = compact(mains.map(node => textContent(node)).join(' '));
  const links = mainElements.filter(node => node.name === 'a' && attribute(node, 'href')).map(node => attribute(node, 'href'));
  const schemas: Record<string, unknown>[] = [];
  for (const node of select('script').filter(node => attribute(node, 'type').toLowerCase() === 'application/ld+json')) {
    try { schemas.push(...schemaObjects(JSON.parse(textContent(node, true)))); }
    catch { if (indexable) issues.push('invalid JSON-LD'); }
  }
  const dates = schemas.filter(value => ['WebPage', 'Article', 'CollectionPage'].some(type => schemaHasType(value, type)))
    .filter(value => !value.url || value.url === canonical).map(value => value.dateModified).filter(value => value !== undefined);
  const invalidDate = dates.some(value => !validDate(value));
  const lastmod = dates.filter(validDate).sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1);
  if (indexable) {
    if (titles.length !== 1 || !title) issues.push('exactly one nonempty title required');
    if (descriptions.length !== 1 || !description) issues.push('exactly one nonempty meta description required');
    if (canonicalNodes.length !== 1 || !canonical) issues.push('exactly one canonical required');
    if (select('h1').length !== 1 || !compact(select('h1').map(node => textContent(node)).join(''))) issues.push('exactly one nonempty H1 required');
    if (mains.length !== 1 || mainText.length < 40) issues.push('one main with meaningful rendered body text required');
    if (!language) issues.push('HTML language required');
    if (invalidDate) issues.push('invalid JSON-LD dateModified');
    if (/^\/(?:en\/)?404(?:\.html|\/|$)/.test(path)) issues.push('error page must be noindex');
    const detail = /^\/(?:en\/)?(?:resource|guides)\/[^/]+\/$/.test(path);
    if (detail && !schemas.some(value => schemaHasType(value, 'BreadcrumbList'))) issues.push('detail page requires BreadcrumbList JSON-LD');
    if (/^\/(?:en\/)?guides\/[^/]+\/$/.test(path) && !schemas.some(value => schemaHasType(value, 'Article'))) issues.push('guide requires Article JSON-LD');
    if (/^\/(?:en\/)?resource\/[^/]+\/$/.test(path)) {
      for (const section of RESOURCE_SECTIONS) {
        if (!mainElements.some(node => attribute(node, 'data-seo-section') === section && compact(textContent(node)).length >= 5)) issues.push(`resource requires meaningful ${section} section`);
      }
      for (const field of RESOURCE_FIELDS) {
        const node = mainElements.find(item => attribute(item, 'data-seo-field') === field);
        if (!node || !compact(textContent(node))) issues.push(`resource requires ${field}`);
        else if (field === 'source-url' && (node.name !== 'a' || !/^https?:\/\//.test(attribute(node, 'href')))) issues.push('resource source-url must be a real external link');
      }
    }
    if (/^\/(?:en\/)?tag\/[^/]+\/$/.test(path)) {
      const resources = new Set(links.map(href => href.match(/\/resource\/([^/?#]+)\/?(?:[?#]|$)/)?.[1]).filter(Boolean));
      if (resources.size < 3) issues.push('indexable tag requires at least three resource links');
    }
  }
  return { file, path, language, title, description, canonical, indexable, redirect,
    alternates: select('link').filter(node => hasRel(node, 'alternate') && attribute(node, 'hreflang')).map(node => ({ language: attribute(node, 'hreflang').toLowerCase(), href: attribute(node, 'href') })),
    links, ...(lastmod ? { lastmod } : {}), issues };
}

function parseUrl(value: string, base?: string): URL | undefined {
  try { return new URL(value, base); } catch { return undefined; }
}
function languageMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.split('-')[0] === expected.split('-')[0];
}
function assertNoIssues(issues: string[]): void {
  if (issues.length) throw new Error(`SEO verification failed (${issues.length}):\n${issues.map(issue => `- ${issue}`).join('\n')}`);
}

export function validatePages(pages: BuiltPage[], site: string, files = new Set(pages.map(page => page.file))): void {
  const origin = new URL(site).origin;
  const byPath = new Map(pages.map(page => [page.path, page]));
  const titles = new Map<string, string>();
  const canonicals = new Map<string, string>();
  const issues: string[] = [];
  for (const page of pages.filter(item => item.indexable)) {
    const fail = (message: string) => issues.push(`${page.path}: ${message}`);
    page.issues.forEach(fail);
    const canonical = parseUrl(page.canonical);
    if (!canonical || canonical.origin !== origin || canonical.search || canonical.hash || canonical.pathname !== page.path) fail('canonical must be an absolute, same-site, self-referencing URL without query/hash');
    if (canonical && !byPath.get(canonical.pathname)?.indexable) fail('canonical target missing, redirected or noindex');
    if (canonicals.has(page.canonical)) fail(`duplicate canonical with ${canonicals.get(page.canonical)}`);
    canonicals.set(page.canonical, page.path);
    const titleKey = `${page.language}:${page.title.toLowerCase()}`;
    if (titles.has(titleKey)) fail(`duplicate title with ${titles.get(titleKey)}`);
    titles.set(titleKey, page.path);
    const internal = page.links.map(href => parseUrl(href, `${origin}${page.path}`)).filter((url): url is URL => Boolean(url && url.origin === origin && url.pathname !== page.path));
    if (!internal.length) fail('main content requires a real internal link');
    for (const link of internal) {
      // Query links and non-HTML files are checked by their respective renderers.
      if (link.search || extname(link.pathname) && !link.pathname.endsWith('.html')) continue;
      const target = byPath.get(link.pathname) ?? byPath.get(`${link.pathname}/`);
      if (!target && !files.has(decodeURIComponent(link.pathname).slice(1))) fail(`internal HTML link has no build target: ${link.pathname}`);
    }
    const alternateLanguages = new Set<string>();
    for (const alternate of page.alternates) {
      if (alternateLanguages.has(alternate.language)) fail(`duplicate hreflang ${alternate.language}`);
      alternateLanguages.add(alternate.language);
      const url = parseUrl(alternate.href);
      const target = url?.origin === origin && !url.search && !url.hash ? byPath.get(url.pathname) : undefined;
      if (!target?.indexable || target.canonical !== alternate.href) { fail(`hreflang ${alternate.language} must target an existing indexable canonical page: ${alternate.href}`); continue; }
      if (alternate.language !== 'x-default' && !languageMatches(target.language, alternate.language)) fail(`hreflang ${alternate.language} target has language ${target.language}`);
      if (alternate.language !== 'x-default' && !target.alternates.some(back => languageMatches(back.language, page.language) && back.href === page.canonical)) fail(`hreflang ${alternate.language} target is missing reciprocal link`);
    }
    if (page.alternates.length && !page.alternates.some(item => languageMatches(item.language, page.language) && item.href === page.canonical)) fail('hreflang set must include the page itself');
  }
  if (!pages.some(page => page.indexable)) issues.push('build has no indexable HTML pages');
  assertNoIssues(issues);
}

function xml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function groupFor(path: string): SitemapGroup {
  const base = path.replace(/^\/en\//, '/');
  if (base.startsWith('/resource/') || base.startsWith('/skills/')) return 'resources';
  if (/^\/(guides|insights)\/[^/]+\/$/.test(base)) return 'guides';
  if (base.startsWith('/agents/')) return 'agents';
  if (base.startsWith('/tag/')) return 'tags';
  return 'static';
}

/** Dates come only from authored page metadata. Deployment time is never a lastmod. */
export function renderSitemaps(pages: BuiltPage[], site: string): SitemapFiles {
  const origin = new URL(site).origin;
  const files: SitemapFiles = {};
  const eligible = pages.filter(page => page.indexable && !page.redirect && page.canonical === `${origin}${page.path}`).sort((a, b) => a.canonical.localeCompare(b.canonical));
  for (const group of SITEMAP_GROUPS) {
    const items = eligible.filter(page => groupFor(page.path) === group).map(page => `  <url><loc>${xml(page.canonical)}</loc>${page.lastmod ? `<lastmod>${xml(page.lastmod)}</lastmod>` : ''}</url>`);
    files[`sitemap-${group}.xml`] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</urlset>\n`;
  }
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITEMAP_GROUPS.map(group => `  <sitemap><loc>${xml(`${origin}/sitemap-${group}.xml`)}</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`;
  return files;
}

export function validateSitemaps(files: SitemapFiles, pages: BuiltPage[], site: string): void {
  const origin = new URL(site).origin;
  const expected = new Set(pages.filter(page => page.indexable && !page.redirect).map(page => page.canonical));
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const group of SITEMAP_GROUPS) {
    const file = `sitemap-${group}.xml`;
    if (!files[file]) { issues.push(`missing ${file}`); continue; }
    for (const match of files[file]!.matchAll(/<loc>([\s\S]*?)<\/loc>/g)) {
      const url = decodeHTML(match[1]!);
      if (!expected.has(url)) issues.push(`${file} contains nonindexable, redirected, missing or noncanonical URL: ${url}`);
      if (seen.has(url)) issues.push(`sitemap duplicate URL: ${url}`);
      seen.add(url);
    }
  }
  for (const url of expected) if (!seen.has(url)) issues.push(`sitemap missing indexable URL: ${url}`);
  const indexLocations = Array.from((files['sitemap.xml'] ?? '').matchAll(/<loc>([\s\S]*?)<\/loc>/g), match => decodeHTML(match[1]!));
  if (indexLocations.length !== SITEMAP_GROUPS.length || SITEMAP_GROUPS.some(group => !indexLocations.includes(`${origin}/sitemap-${group}.xml`))) issues.push('sitemap.xml must reference each generated sitemap exactly once');
  assertNoIssues(issues);
}

async function listFiles(directory: string, base = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? listFiles(join(directory, entry.name), base) : Promise.resolve([relative(base, join(directory, entry.name)).replaceAll('\\', '/')])));
  return nested.flat().sort();
}

export async function runSeoBuild(outDir = join(WEB_ROOT, 'dist'), site = process.env.SITE_URL || 'https://skillflux.app'): Promise<{ pages: number; indexable: number }> {
  const files = await listFiles(outDir);
  const pages = await Promise.all(files.filter(file => file.endsWith('.html')).map(async file => inspectHtml(file, await readFile(join(outDir, file), 'utf8'))));
  validatePages(pages, site, new Set(files));
  const sitemaps = renderSitemaps(pages, site);
  validateSitemaps(sitemaps, pages, site);
  // Remove only obsolete sitemap build artifacts from the previous integration.
  await Promise.all(files.filter(file => /^sitemap-(?:index|\d+)\.xml$/.test(file)).map(file => rm(join(outDir, file))));
  await Promise.all(Object.entries(sitemaps).map(([file, content]) => writeFile(join(outDir, file), content)));
  return { pages: pages.length, indexable: pages.filter(page => page.indexable).length };
}

export async function finalizeBuild(outDir: string): Promise<void> {
  const result = await runSeoBuild(outDir);
  const { buildDeployment } = await import('./build-deployment');
  await buildDeployment(outDir);
  process.stdout.write(`SEO verified ${result.indexable} indexable pages across ${result.pages} HTML files; generated canonical sitemaps and deployment rules.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../dist'));
  finalizeBuild(output).catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
}
