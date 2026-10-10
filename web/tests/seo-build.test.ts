import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectHtml, renderSitemaps, runSeoBuild, validatePages, validateSitemaps, type BuiltPage } from '../scripts/seo-build';

const SITE = 'https://skillflux.example';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

type Options = { title?: string; language?: string; head?: string; body?: string; robots?: string; canonical?: string };
function html(path: string, options: Options = {}): string {
  return `<!doctype html><html lang="${options.language ?? 'en'}"><head><title>${options.title ?? `Page ${path}`}</title>
    <meta name="description" content="Independent useful page description for this exact subject.">
    <meta name="robots" content="${options.robots ?? 'index,follow'}">
    <link rel="canonical" href="${options.canonical ?? SITE + path}">${options.head ?? ''}</head>
    <body><main><h1>${options.title ?? `Page ${path}`}</h1><p>This page explains a real subject with enough server rendered body text to be useful.</p>
    <a href="${path === '/' ? '/directory/' : '/'}">${path === '/' ? 'Browse source directory' : 'SkillFlux home'}</a>${options.body ?? ''}</main></body></html>`;
}
function page(path: string, options: Options = {}): BuiltPage {
  return inspectHtml(path === '/' ? 'index.html' : `${path.slice(1)}index.html`, html(path, options));
}
function base(): BuiltPage[] { return [page('/'), page('/directory/')]; }
function jsonLd(value: unknown): string { return `<script type="application/ld+json">${JSON.stringify(value)}</script>`; }
const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }] };
function resource(options: Options = {}): BuiltPage {
  return page('/resource/editor/', {
    head: jsonLd([breadcrumb, { '@type': 'WebPage', dateModified: '2026-08-14' }]),
    body: ['best-for', 'use-cases', 'notes', 'limitations', 'alternatives'].map(section => `<section data-seo-section="${section}"><h2>${section}</h2><p>Independent useful context for the ${section} requirement.</p></section>`).join('')
      + '<p data-seo-field="resource-type">Agent skill</p><p data-seo-field="source-type">Official vendor</p><a data-seo-field="source-url" href="https://upstream.example/editor/">Original editor source</a>',
    ...options,
  });
}

describe('generated HTML SEO gate', () => {
  it('accepts canonical pages and a complete resource with author-maintained dateModified', () => {
    const pages = [...base(), resource()];
    expect(() => validatePages(pages, SITE)).not.toThrow();
    expect(pages[2]?.lastmod).toBe('2026-08-14');
  });

  it.each(['2026-10-10', '2026-10-10T09:30:00+08:00'])('reads an authored TechArticle dateModified of %s', dateModified => {
    const article = page('/insights/skill-workflow/', {
      head: jsonLd({ '@type': 'TechArticle', url: SITE + '/insights/skill-workflow/', dateModified }),
    });
    expect(() => validatePages([...base(), article], SITE)).not.toThrow();
    expect(article.lastmod).toBe(dateModified);
  });

  it.each(['2026-02-31', 'recently', 20261010])('rejects an invalid TechArticle dateModified of %s', dateModified => {
    const article = page('/insights/skill-workflow/', {
      head: jsonLd({ '@type': 'TechArticle', url: SITE + '/insights/skill-workflow/', dateModified }),
    });
    expect(article.lastmod).toBeUndefined();
    expect(() => validatePages([...base(), article], SITE)).toThrow(/invalid JSON-LD dateModified/);
  });

  it('ignores dates from other TechArticle URLs, including invalid dates', () => {
    const otherArticles = [
      { '@type': 'TechArticle', url: SITE + '/insights/another-skill/', dateModified: '2026-10-11' },
      { '@type': 'TechArticle', url: 'https://upstream.example/article/', dateModified: 'invalid' },
    ];
    const article = page('/insights/skill-workflow/', {
      head: jsonLd({ '@graph': [
        ...otherArticles,
        { '@type': ['Article', 'TechArticle'], url: SITE + '/insights/skill-workflow/', dateModified: '2026-10-10' },
      ] }),
    });
    const undated = page('/insights/undated/', { head: jsonLd(otherArticles) });
    expect(() => validatePages([...base(), article, undated], SITE)).not.toThrow();
    expect(article.lastmod).toBe('2026-10-10');
    expect(undated.lastmod).toBeUndefined();
  });

  it('rejects absent metadata, duplicate H1s, empty bodies, and duplicate titles', () => {
    const invalid = inspectHtml('broken/index.html', '<html lang="en"><head><title></title></head><body><main><h1></h1><h1>Extra</h1></main></body></html>');
    expect(() => validatePages([...base(), invalid], SITE)).toThrow(/nonempty title/);
    expect(invalid.issues.join(' ')).toMatch(/description.*canonical.*H1.*meaningful/);
    expect(() => validatePages([page('/', { title: 'Same title' }), page('/directory/', { title: 'Same title' })], SITE)).toThrow(/duplicate title/);
  });

  it('rejects shared/offsite/query canonicals and canonical targets that are missing or noindex', () => {
    expect(() => validatePages([...base(), page('/second/', { canonical: SITE + '/directory/' })], SITE)).toThrow(/duplicate canonical/);
    for (const canonical of ['https://other.example/missing/', SITE + '/missing/', SITE + '/?q=filter', SITE + '/private/']) {
      const pages = [...base(), page('/private/', { robots: 'noindex,follow' }), page('/second/', { canonical })];
      expect(() => validatePages(pages, SITE)).toThrow(/canonical/);
    }
  });

  it('ignores noindex and redirect bodies but prevents error pages from becoming indexable', () => {
    const noindex = inspectHtml('private/index.html', '<html><head><meta name="robots" content="noindex,follow"></head></html>');
    const redirected = inspectHtml('old/index.html', '<html><head><meta http-equiv="refresh" content="0;url=/directory/"></head></html>');
    expect(() => validatePages([...base(), noindex, redirected], SITE)).not.toThrow();
    expect(() => validatePages([...base(), page('/404/')], SITE)).toThrow(/error page must be noindex/);
    const maps = renderSitemaps([...base(), noindex, redirected], SITE);
    expect(Object.values(maps).join('')).not.toContain(`${SITE}/private/`);
    expect(Object.values(maps).join('')).not.toContain(`${SITE}/old/`);
  });

  it('rejects incomplete resources and thin indexable tags while permitting an unfinished noindex resource', () => {
    expect(() => validatePages([...base(), resource({ body: '<p>No editorial sections here.</p>' })], SITE)).toThrow(/best-for.*\n.*use-cases/s);
    expect(() => validatePages([...base(), page('/resource/draft/', { robots: 'noindex,follow' })], SITE)).not.toThrow();
    expect(() => validatePages([...base(), page('/tag/one/', { body: '<a href="/resource/editor/">Editor</a>' }), resource()], SITE)).toThrow(/at least three resource links/);
  });

  it('requires actual article and breadcrumb markup, and refuses invalid authored dates', () => {
    expect(() => validatePages([...base(), page('/guides/choosing/')], SITE)).toThrow(/BreadcrumbList/);
    expect(() => validatePages([...base(), page('/guides/choosing/', { head: jsonLd(breadcrumb) })], SITE)).toThrow(/Article/);
    expect(() => validatePages([...base(), resource({ head: jsonLd([breadcrumb, { '@type': 'WebPage', dateModified: '2026-02-31' }]) })], SITE)).toThrow(/invalid JSON-LD dateModified/);
    expect(() => validatePages([...base(), resource({ head: '<script type="application/ld+json">{invalid}</script>' })], SITE)).toThrow(/invalid JSON-LD/);
  });

  it('rejects missing internal HTML targets without treating file and query links as static pages', () => {
    expect(() => validatePages([...base(), page('/extra/', { body: '<a href="/missing/">Missing resource</a>' })], SITE)).toThrow(/internal HTML link has no build target/);
    expect(() => validatePages([...base(), page('/extra/', { body: '<a href="/skills-index.json">Skill index</a><a href="/directory/?q=all&amp;sort=name">Filtered directory</a>' })], SITE)).not.toThrow();
  });

  it('requires real language-correct reciprocal alternate targets; x-default never substitutes for an English page', () => {
    const alternate = (language: string, path: string) => `<link rel="alternate" hreflang="${language}" href="${SITE}${path}">`;
    const head = alternate('zh-CN', '/') + alternate('en', '/en/') + alternate('x-default', '/en/');
    const pages = [page('/', { language: 'zh-CN', head }), page('/en/', { language: 'en', head }), page('/directory/')];
    expect(() => validatePages(pages, SITE)).not.toThrow();
    expect(() => validatePages([pages[0]!, { ...pages[1]!, language: 'zh-CN' }, pages[2]!], SITE)).toThrow(/target has language/);
    expect(() => validatePages([pages[0]!, { ...pages[1]!, alternates: [] }, pages[2]!], SITE)).toThrow(/missing reciprocal link/);
    expect(() => validatePages([pages[0]!, pages[2]!], SITE)).toThrow(/existing indexable canonical page/);
    expect(() => validatePages([pages[0]!, { ...pages[1]!, indexable: false }, pages[2]!], SITE)).toThrow(/existing indexable canonical page/);
  });
});

describe('canonical sitemap generation', () => {
  it('carries TechArticle dates into the insight, scenario, and skill sitemaps', () => {
    const articles = [
      { path: '/insights/skill-workflow/', group: 'guides', dateModified: '2026-10-08' },
      { path: '/scenarios/connect-a-project/', group: 'static', dateModified: '2026-10-09' },
      { path: '/skills/grill-me/', group: 'resources', dateModified: '2026-10-10' },
    ];
    const pages = [...base(), ...articles.map(({ path, dateModified }) => page(path, {
      head: jsonLd({ '@type': 'TechArticle', url: SITE + path, dateModified }),
    }))];
    expect(() => validatePages(pages, SITE)).not.toThrow();
    const files = renderSitemaps(pages, SITE);
    expect(() => validateSitemaps(files, pages, SITE)).not.toThrow();
    for (const { path, group, dateModified } of articles) {
      expect(files[`sitemap-${group}.xml`]).toContain(`<url><loc>${SITE}${path}</loc><lastmod>${dateModified}</lastmod></url>`);
    }
    expect(Object.values(files).join('').match(/<lastmod>/g)).toHaveLength(articles.length);
  });

  it('rejects sitemap pollution, duplicate URLs, missing pages, and a broken sitemap index', () => {
    const pages = [...base(), resource()];
    const files = renderSitemaps(pages, SITE);
    expect(() => validateSitemaps(files, pages, SITE)).not.toThrow();
    for (const bad of [SITE + '/private/', SITE + '/missing/', SITE + '/old/']) {
      expect(() => validateSitemaps({ ...files, 'sitemap-static.xml': files['sitemap-static.xml']!.replace('</urlset>', `<url><loc>${bad}</loc></url></urlset>`) }, pages, SITE)).toThrow(/nonindexable, redirected, missing or noncanonical/);
    }
    expect(() => validateSitemaps({ ...files, 'sitemap-tags.xml': files['sitemap-static.xml']! }, pages, SITE)).toThrow(/duplicate URL/);
    expect(() => validateSitemaps({ ...files, 'sitemap-resources.xml': '<urlset></urlset>' }, pages, SITE)).toThrow(/missing indexable URL/);
    expect(() => validateSitemaps({ ...files, 'sitemap.xml': '<sitemapindex></sitemapindex>' }, pages, SITE)).toThrow(/reference each generated sitemap/);
  });

  it('writes deterministic split sitemaps into the supplied build directory without inventing lastmod', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skillflux-seo-test-'));
    directories.push(directory);
    await mkdir(join(directory, 'directory'));
    await writeFile(join(directory, 'index.html'), html('/', { head: jsonLd({ '@type': 'WebPage', dateModified: '2026-08-14' }) }));
    await writeFile(join(directory, 'directory/index.html'), html('/directory/'));
    await writeFile(join(directory, 'sitemap-0.xml'), 'stale previous build');
    await expect(runSeoBuild(directory, SITE)).resolves.toEqual({ pages: 2, indexable: 2 });
    const first = await readFile(join(directory, 'sitemap-static.xml'), 'utf8');
    expect(first.match(/<lastmod>/g)).toHaveLength(1);
    expect(first).toContain('<lastmod>2026-08-14</lastmod>');
    await runSeoBuild(directory, SITE);
    expect(await readFile(join(directory, 'sitemap-static.xml'), 'utf8')).toBe(first);
    await expect(readFile(join(directory, 'sitemap-0.xml'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(directory, 'sitemap.xml'), 'utf8')).toContain('sitemap-resources.xml');
  });
});
