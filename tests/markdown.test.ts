import { markdownToHtml } from 'satteri';
import { expect, test } from 'vitest';
import { safeMarkdown } from '../src/lib/markdown';

const md = 'Hi <b>x</b>\n\n<script>alert(1)</script>\n\n![a chart](https://evil.example/x.png)\n\n## Week 4\n\n**Bold** and [a link](/standings).';
const render = (src: string) => markdownToHtml(src, { mdastPlugins: [safeMarkdown] }).html;

test('without the plugin, raw HTML and remote images pass through (why it exists)', () => {
  const html = markdownToHtml(md).html;
  expect(html).toContain('<script>');
  expect(html).toContain('<img');
});

test('raw HTML renders as visible escaped text', () => {
  const html = render(md);
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<b>');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('images become their alt text', () => {
  const html = render(md);
  expect(html).not.toContain('<img');
  expect(html).not.toContain('evil.example');
  expect(html).toContain('a chart');
});

test('normal markdown still renders', () => {
  const html = render(md);
  expect(html).toContain('<h2>Week 4</h2>');
  expect(html).toContain('<strong>Bold</strong>');
  expect(html).toContain('<a href="/standings">a link</a>');
});
