import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { momentumPct, sampleMomentum, serializeMomentum, sparkline, trendRows, weeklyPoints } from '../src/lib/trends';
import type { Matchup } from '../src/lib/sleeper';
import type { Players } from '../src/lib/stats';

const load = <T>(p: string): T => JSON.parse(readFileSync(`tests/fixtures/${p}.json`, 'utf8'));
const P = load<Players>('players');
const weeks26 = [1, 2, 3, 4].map(w => load<Matchup[]>(`matchups-${w}`));
const weeks25 = Array.from({ length: 14 }, (_, i) => load<Matchup[]>(`history/2025/matchups-${i + 1}`));
const fc = (value: number, trend30Day?: number) => ({ player: { id: 1, name: 'X', position: 'WR', sleeperId: '1' }, value, redraftValue: value, trend30Day });

test('weekly points per player, null for weeks not on a roster in this league', () => {
  const m = weeks26[0]!.find(x => x.points > 0)!;
  const id = m.starters.find(s => s !== '0')!;
  expect(weeklyPoints(weeks26, id)[0]).toBe(m.players_points![id]);
  expect(weeklyPoints(weeks26, 'not-a-player')).toEqual([null, null, null, null]);
});

test('momentum is the 30 day trend over the value 30 days ago', () => {
  expect(momentumPct(fc(1200, 200))).toBe(0.2);
  expect(momentumPct(fc(800, -200))).toBe(-0.2);
  expect(momentumPct(fc(100, 100))).toBeNull(); // no base 30 days ago
  expect(momentumPct(fc(100))).toBeNull(); // field missing
});

test('rows: rostered QB/RB/WR/TE only, 2026 average and change vs 2025, momentum when known, best first', () => {
  const rosters = load<{ roster_id: number; players: string[] | null }[]>('rosters');
  const anyId = rosters[0]!.players!.find(id => ['QB', 'RB', 'WR', 'TE'].includes(P[id]?.pos ?? ''))!;
  const rows = trendRows(rosters, P, weeks26, weeks25, { [anyId]: 0.12 });
  expect(rows.every(r => ['QB', 'RB', 'WR', 'TE'].includes(r.pos))).toBe(true);
  expect(rows.find(r => r.id === anyId)!.momentum).toBe(0.12);
  expect(rows.filter(r => r.id !== anyId).every(r => r.momentum === null)).toBe(true);
  for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.avg26 ?? -1).toBeGreaterThanOrEqual(rows[i]!.avg26 ?? -1);
  const full = rows.find(r => r.s25.every(x => x !== null) && r.s26.every(x => x !== null))!;
  const mean = (xs: (number | null)[]) => (xs as number[]).reduce((a, b) => a + b, 0) / xs.length;
  expect(full.avg26).toBeCloseTo(mean(full.s26), 5);
  expect(full.diff).toBeCloseTo(mean(full.s26) - mean(full.s25), 5);
  const rookie = rows.find(r => r.s25.every(x => x === null));
  if (rookie) expect(rookie.diff).toBeNull();
});

test('sparkline geometry: spans the box, zero baseline, gaps break the line', () => {
  const sp = sparkline([0.1, null, -0.1, 0.1], 100, 20, { pad: 0, zero: true });
  expect(sp.zeroY).toBe(10);
  expect(sp.d).toBe('M0.0,0.0 M66.7,20.0 L100.0,0.0');
  expect(sp.last).toEqual({ x: 100, y: 0 });
  expect(sparkline([5], 100, 20, { pad: 0 }).last).toEqual({ x: 100, y: 0 });
});

test('sample momentum is made up but stable, for local previews only', () => {
  expect(sampleMomentum(['1', '2'])).toEqual(sampleMomentum(['1', '2']));
  expect(Object.values(sampleMomentum(['1', '2'])).every(v => Math.abs(v) <= 0.3)).toBe(true);
});

test('the committed momentum file holds percentages only, never values', () => {
  const text = serializeMomentum('2026-10-09', { a: 0.123, b: -0.05 });
  expect(JSON.parse(text)).toEqual({ fetched: '2026-10-09', momentum: { a: 0.123, b: -0.05 } });
  expect(text).not.toMatch(/"(value|values|redraftValue|trend30Day)"/);
});
