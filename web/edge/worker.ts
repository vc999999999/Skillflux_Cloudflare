import { isFacetedUrl } from '../src/lib/indexing-policy';

declare const __SEO_REDIRECTS__: Record<string, string>;
declare const __SEO_PAGES__: string[];
const redirects = __SEO_REDIRECTS__;
const pages = new Set(__SEO_PAGES__);
const primaryHost = 'skillflux.app';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (['skillflux.cn', 'www.skillflux.cn', 'www.skillflux.app'].includes(url.hostname)) {
      url.protocol = 'https:';
      url.hostname = primaryHost;
      return Response.redirect(url.href, 308);
    }
    if (url.protocol === 'http:' && !loopback) {
      url.protocol = 'https:';
      return Response.redirect(url.href, 308);
    }
    if (/^\/console(?:\/(?:index\.html)?)?$/.test(url.pathname)) {
      return Response.redirect(new URL('/registry/', url.origin).href, 301);
    }
    if (/^\/(?:_worker\.js|_routes\.json|_redirects|_headers|\.assetsignore)\/?$/.test(url.pathname)) {
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

    // force-trailing-slash serves the 404.html asset at /404/ with status 200.
    // Fetch that canonical asset directly and preserve its body as an actual error.
    const errorPage = /^\/404(?:\.html)?\/?$/.test(url.pathname);
    const assetRequest = errorPage ? new Request(new URL('/404/', url), request) : request;
    const response = await env.ASSETS.fetch(assetRequest);
    const result = new Response(response.body, {
      status: errorPage ? 404 : response.status,
      statusText: errorPage ? 'Not Found' : response.statusText,
      headers: response.headers
    });
    if (errorPage) result.headers.delete('Location');
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
