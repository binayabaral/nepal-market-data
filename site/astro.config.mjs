import { defineConfig } from 'astro/config';

// GitHub reports this repo's Pages site at https://binayabaral.github.io/nepal-market-data/, so the
// base path is the repo name. Moving to a custom domain means setting SITE_BASE=/ and nothing else:
// every link and fetch in the site is built from import.meta.env.BASE_URL.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://binayabaral.github.io',
  base: process.env.SITE_BASE ?? '/nepal-market-data/',
  output: 'static',
  trailingSlash: 'ignore'
});
