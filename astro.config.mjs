import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.SITE_URL || "https://skillflux.cn";

export default defineConfig({
  site,
  output: "static",
  // Deep-dive articles are zh-only; the en language switcher lands back on zh.
  redirects: {
    "/en/insights/[slug]": "/insights/[slug]"
  },
  integrations: [sitemap()],
  build: {
    inlineStylesheets: "auto"
  },
  vite: {
    build: {
      assetsInlineLimit: 0
    }
  }
});
