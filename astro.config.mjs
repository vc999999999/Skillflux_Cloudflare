import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.SITE_URL || "https://skillflux.cn";

export default defineConfig({
  site,
  output: "static",
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
