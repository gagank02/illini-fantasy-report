import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  // External CSS/JS files keep the CSP strict: only the theme snippet needs a hash.
  build: { inlineStylesheets: 'never' },
  vite: { build: { assetsInlineLimit: 0 } },
});
