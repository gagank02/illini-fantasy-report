import { expect, test } from 'vitest';
import { layoutHeadline, renderCard, stripEmoji } from '../src/lib/og';

test('stripEmoji drops emoji with skin tones and tidies spaces', () => {
  expect(stripEmoji('Riceman szn 🥶🧊👌🏽 by 72.38')).toBe('Riceman szn by 72.38');
  expect(stripEmoji('beat 👨‍👩‍👧 Dads , again')).toBe('beat Dads, again');
  expect(stripEmoji('fr0styishere')).toBe('fr0styishere');
});

test('short headlines get a large size and long ones still fit', () => {
  const short = layoutHeadline('fr0styishere wins');
  expect(short.size).toBe(80);
  expect(short.lines).toEqual(['fr0styishere wins']);

  const long = layoutHeadline('word '.repeat(60).trim());
  expect(long.size).toBeLessThan(80);
  expect(long.lines.length * long.size * 1.12).toBeLessThanOrEqual(358);
});

test('renders a 1200x630 PNG', () => {
  const png = renderCard({ kicker: 'Week 4 · October 7, 2026', headline: 'A <headline> & "quotes" 🥶' });
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});
