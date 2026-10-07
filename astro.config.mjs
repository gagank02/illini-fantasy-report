import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  // External CSS/JS files keep the CSP strict: only the theme snippet needs a hash.
  // standings.html, not standings/index.html, so Cloudflare serves /standings without a redirect.
  build: { inlineStylesheets: 'never', format: 'file' },
  vite: { build: { assetsInlineLimit: 0 } },
});
