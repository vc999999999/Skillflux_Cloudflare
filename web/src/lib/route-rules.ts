// Pure routing rules shared by the edge Worker, the dev middleware and the
// build. No data imports: the Worker receives redirect and gone tables as
// build-time constants.

export type GoneRules = { exact: string[]; prefixes: string[] };
export type RouteDecision = { kind: 'redirect'; location: string } | { kind: 'gone' };

export function withTrailingSlash(pathname: string): string {
  return /\.[a-z0-9]+$/i.test(pathname) || pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export function isGone(pathname: string, gone: GoneRules): boolean {
  const path = withTrailingSlash(pathname);
  return gone.exact.includes(path) || gone.exact.includes(pathname)
    || gone.prefixes.some(prefix => path.startsWith(prefix));
}

/**
 * One decision per request, so a retired URL never chains through several
 * hops. Exact legacy mappings win; then the retired `/en/` prefix collapses
 * onto the English root, resolving any mapping of the result in the same hop.
 */
export function resolveRoute(pathname: string, redirects: Record<string, string>, gone: GoneRules): RouteDecision | undefined {
  const exact = redirects[pathname] ?? redirects[withTrailingSlash(pathname)];
  if (exact) return { kind: 'redirect', location: exact };
  const bare = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, '') || '/';
  if (isGone(bare, gone)) return { kind: 'gone' };
  if (/^\/en(?:\/|$)/.test(pathname)) {
    const target = redirects[bare] ?? redirects[withTrailingSlash(bare)] ?? withTrailingSlash(bare);
    return { kind: 'redirect', location: target };
  }
  return undefined;
}

export const GONE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex, follow',
  'Cache-Control': 'public, max-age=3600'
} as const;

export function renderGonePage(): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, follow"><title>Gone · SkillFlux</title></head>',
    '<body style="font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">',
    '<h1>This page has been retired.</h1>',
    '<p>SkillFlux no longer distributes or installs skills, so the installer, release and package pages were removed. The last version of that tool is archived in the repository under the tag <code>v1.3.0-tool-final</code>.</p>',
    '<p><a href="/directory/">Browse the directory</a> · <a href="/">Home</a></p>',
    '</body></html>'
  ].join('');
}
