import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync('src/styles/global.css', 'utf8');

/** Returns [light, dark] hex values for a `--name: light-dark(#..., #...)` token. */
function token(name: string): [string, string] {
  const m = css.match(new RegExp(`--${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`, 'i'));
  if (!m) throw new Error(`token --${name} not found`);
  return [m[1]!, m[2]!];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test('contrast helper matches known values', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
  expect(contrast('#FF5F05', '#ffffff')).toBeLessThan(4.5); // why raw orange can't be light mode text
});

for (const [fg, bg] of [['fg', 'bg'], ['accent-text', 'bg'], ['muted', 'bg'], ['fg', 'surface'], ['accent-text', 'surface']]) {
  test(`--${fg} on --${bg} meets WCAG AA in both themes`, () => {
    const [fl, fd] = token(fg!);
    const [bl, bd] = token(bg!);
    expect(contrast(fl, bl)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fd, bd)).toBeGreaterThanOrEqual(4.5);
  });
}
