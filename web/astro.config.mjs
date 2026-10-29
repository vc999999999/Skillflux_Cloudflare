import { defineConfig } from "astro/config";
import { getLegacyRedirects } from "./src/lib/seo-routes.ts";

const site = process.env.SITE_URL || "https://skillflux.app";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  // Static fallbacks for the legacy URLs the edge Worker redirects in production.
  redirects: Object.fromEntries(Object.entries(getLegacyRedirects()).filter(([path]) => !path.endsWith('.xml')).map(([path, destination]) => [path.replace(/\/$/, ''), { status: 301, destination }])),
  build: {
    inlineStylesheets: "auto"
  },
  vite: {
    build: {
      assetsInlineLimit: 0
    }
  }
});
