// Every place that shows Sleeper, FantasyCalc or nflverse data must credit it. These checks read the source, so a new
// page that forgets a credit fails here instead of shipping.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const pages = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.astro') ? [join(dir, e.name)] : []));
const read = (f: string) => readFileSync(f, 'utf8');
const SLEEPER_LINK = 'href="https://sleeper.com"';
const FC_LINK = 'href="https://fantasycalc.com"';

test('the footer on every page credits and links both Sleeper and FantasyCalc', () => {
  const footer = read('src/layouts/Base.astro').match(/<footer[\s\S]*<\/footer>/)![0];
  expect(footer).toContain(SLEEPER_LINK);
  expect(footer).toContain(FC_LINK);
  expect(footer).toMatch(/not affiliated with or endorsed by[^<]*Sleeper[^<]*FantasyCalc/i);
});

test('every page renders inside the layout with that footer', () => {
  for (const f of pages('src/pages')) expect(read(f), f).toMatch(/import (Base|ReportLayout) from/);
  expect(read('src/layouts/ReportLayout.astro')).toMatch(/import Base from/);
});

test('every page showing FantasyCalc data credits it next to the data, with a link, and credits Sleeper too', () => {
  const fcPages = pages('src/pages').filter(f => /loadTrades|loadMomentum/.test(read(f)));
  expect(fcPages.length).toBeGreaterThanOrEqual(2);
  for (const f of fcPages) {
    const credit = read(f).match(/<p class="trade-credit">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(credit, f).toContain(FC_LINK);
    // Every branch of the credit (real, sample, not yet) links Sleeper, since every branch shows Sleeper data.
    const branches = credit.match(/'[^']*'|<>[\s\S]*?<\/>/g) ?? [];
    expect(branches.length, f).toBeGreaterThanOrEqual(2);
    for (const b of branches) expect(b, `${f}: ${b.trim()}`).toContain(SLEEPER_LINK);
  }
});

test('every page showing nflverse data credits and links it next to the data', () => {
  const nflPages = pages('src/pages').filter(f => read(f).includes('loadNflverse'));
  expect(nflPages.length).toBeGreaterThanOrEqual(3);
  for (const f of nflPages) {
    const credit = read(f).match(/<p class="trade-credit">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(credit, f).toContain('href="https://github.com/nflverse"');
  }
});

test('reports credit Sleeper inside the article, so PDF and image exports carry it', () => {
  const article = read('src/layouts/ReportLayout.astro').match(/<article[\s\S]*<\/article>/)![0];
  expect(article.match(/<p class="credit">[\s\S]*?<\/p>/)![0]).toContain(SLEEPER_LINK);
});

test('links to other sites open in a new tab safely (via the Ext component), site links stay in the same tab', () => {
  const files = [...pages('src/pages'), ...pages('src/layouts'), ...pages('src/components')];
  for (const f of files) expect(read(f), f).not.toMatch(/<a\s[^>]*href=["{`]+https?:/);
  const ext = read('src/components/Ext.astro');
  expect(ext).toContain('target="_blank"');
  expect(ext).toContain('rel="noopener noreferrer"');
  expect(ext).toContain('opens in a new tab');
});
