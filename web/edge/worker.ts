import { isFacetedUrl } from '../src/lib/indexing-policy';

declare const __SEO_REDIRECTS__: Record<string, string>;
declare const __SEO_PAGES__: string[];
const redirects = __SEO_REDIRECTS__;
const pages = new Set(__SEO_PAGES__);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (/^\/(?:_nginx-(?:redirects|pagination)\.conf|_worker\.js|_routes\.json|_redirects|_headers|\.assetsignore)\/?$/.test(url.pathname)) {
      return new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex, follow' } });
    }
    const redirect = redirects[url.pathname] ?? redirects[`${url.pathname.replace(/\/$/, '')}/`];
    if (redirect) return Response.redirect(new URL(redirect + url.search, url.origin).href, 301);

    const indexPath = url.pathname.replace(/index\.html$/, '');
    const canonicalPath = indexPath.endsWith('/') ? indexPath : `${indexPath}/`;
    if (pages.has(canonicalPath) && canonicalPath !== url.pathname) {
      return Response.redirect(new URL(canonicalPath + url.search, url.origin).href, 301);
    }
    if (/^\/(?:en\/)?registry\/$/.test(url.pathname) && url.searchParams.has('page') && !isFacetedUrl(url)) {
      const number = Number(url.searchParams.get('page'));
      const path = number === 1 ? url.pathname : `${url.pathname}page/${number}/`;
      if (Number.isSafeInteger(number) && number >= 1 && pages.has(path)) {
        url.searchParams.delete('page');
        return Response.redirect(new URL(path + url.search, url.origin).href, 301);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const result = new Response(response.body, response);
    if (result.status === 404) result.headers.set('X-Robots-Tag', 'noindex, follow');
    if (isFacetedUrl(url) && result.headers.get('Content-Type')?.includes('text/html')) {
      result.headers.set('X-Robots-Tag', 'noindex, follow');
      result.headers.set('Cache-Control', 'private, no-store');
      const directory = url.pathname.replace(/\/page\/\d+\/$/, '/');
      return new HTMLRewriter()
        .on('meta[name="robots"]', { element(el) { el.setAttribute('content', 'noindex, follow'); } })
        .on('link[rel="canonical"]', { element(el) {
          const href = el.getAttribute('href');
          if (href) el.setAttribute('href', new URL(directory, href).href);
        } })
        .transform(result);
    }
    return result;
  }
} satisfies ExportedHandler<Env>;
