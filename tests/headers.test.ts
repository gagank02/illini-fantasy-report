import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const headers = readFileSync('public/_headers', 'utf8');
const csp = headers.match(/Content-Security-Policy: (.+)/)?.[1] ?? '';

test('CSP allows the inline theme script by its exact hash', () => {
  const layout = readFileSync('src/layouts/Base.astro', 'utf8');
  const inline = [...layout.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].map(m => m[1]!);
  expect(inline).toHaveLength(1);
  const hash = createHash('sha256').update(inline[0]!).digest('base64');
  expect(csp).toContain(`'sha256-${hash}'`);
});

test('CSP stays strict', () => {
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
});

test('baseline security headers are set for every path', () => {
  expect(headers.startsWith('/*\n')).toBe(true);
  for (const h of ['X-Content-Type-Options: nosniff', 'Referrer-Policy:', 'X-Frame-Options: DENY', 'Strict-Transport-Security:', 'Permissions-Policy:']) {
    expect(headers).toContain(h);
  }
});
