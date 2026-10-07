import { satteri } from '@astrojs/markdown-satteri';
import { defineConfig } from 'astro/config';
import { safeMarkdown } from './src/lib/markdown.ts';

export default defineConfig({
  output: 'static',
  // External CSS/JS files keep the CSP strict: only the theme snippet needs a hash.
  // standings.html, not standings/index.html, so Cloudflare serves /standings without a redirect.
  build: { inlineStylesheets: 'never', format: 'file' },
  vite: { build: { assetsInlineLimit: 0 } },
  // Reports are written by Claude: never render raw HTML or remote images from them.
  markdown: { processor: satteri({ mdastPlugins: [safeMarkdown] }) },
});
