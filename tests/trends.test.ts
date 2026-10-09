import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { heatingUp, marketMover, momentumPct, sampleMomentum, serializeMomentum, sparkline, trendRows, weeklyPoints, type TrendRow } from '../src/lib/trends';
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

test('this season form: recent weeks vs the weeks before them (last 2 until week 6, then last 3); null before 4 weeks', () => {
  const rows = trendRows([{ roster_id: 1, players: ['a', 'b'] }], { a: { name: 'A', pos: 'WR', team: 'X', injury: null }, b: { name: 'B', pos: 'RB', team: 'X', injury: null } },
    [[{ roster_id: 1, matchup_id: 1, points: 0, starters: [], starters_points: [], players_points: { a: 10, b: 5 } }],
     [{ roster_id: 1, matchup_id: 1, points: 0, starters: [], starters_points: [], players_points: { a: 10 } }],
     [{ roster_id: 1, matchup_id: 1, points: 0, starters: [], starters_points: [], players_points: { a: 20 } }],
     [{ roster_id: 1, matchup_id: 1, points: 0, starters: [], starters_points: [], players_points: { a: 30, b: 9 } }]],
    [], {});
  const a = rows.find(r => r.id === 'a')!;
  expect(a.avg26).toBe(17.5);
  expect(a.recentWeeks).toBe(2);
  expect(a.recent).toBe(25); // weeks 3-4
  expect(a.form).toBe(15); // vs weeks 1-2 (10)
  expect(a.avg25).toBeNull();
  expect(rows.find(r => r.id === 'b')!.form).toBeNull(); // only 2 weeks this season
  // Davante Adams, real 2026 weeks: a bad week 1 must not make a cooling player look hot.
  const davante = trendRows([{ roster_id: 1, players: ['d'] }], { d: { name: 'D', pos: 'WR', team: 'X', injury: null } },
    [5.6, 39.5, 20.7, 7.2].map(v => [{ roster_id: 1, matchup_id: 1, points: 0, starters: [], starters_points: [], players_points: { d: v } }]), [], {})[0]!;
  expect(davante.form).toBeCloseTo(-8.6, 1);
  // From week 6 the window is 3 weeks.
  const six = trendRows([{ roster_id: 1, players: ['s'] }], { s: { name: 'S', pos: 'WR', team: 'X', injury: null } },
    [1, 1, 1, 4, 4, 4].map(v => [{ roster_id: 1, matchup_id: 1, points: 0, starters: [], starters_points: [], players_points: { s: v } }]), [], {})[0]!;
  expect([six.recentWeeks, six.form]).toEqual([3, 3]);
});

test('home card picks: heating up THIS season among regulars, and the biggest market riser', () => {
  const r = (id: string, avg26: number, form: number | null, momentum: number | null): TrendRow =>
    ({ id, pos: 'WR', s25: [], s26: [], avg25: null, avg26, recent: null, recentWeeks: 2, form, diff: null, momentum, luck: null });
  const rows = [r('bench', 3, 9, 7.5), r('a', 20, 5, 0.1), r('b', 15, 8, -0.2), r('c', 12, 2, 0.3), r('early', 18, null, 0.05)];
  expect(heatingUp(rows).map(x => x.id)).toEqual(['b', 'a', 'c']);
  expect(marketMover(rows)!.id).toBe('c');
  expect(marketMover(rows.map(x => ({ ...x, momentum: null })))).toBeNull();
});
