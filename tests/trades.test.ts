import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { valueMap, type FcValue } from '../src/lib/fantasycalc';
import type { League, Roster } from '../src/lib/sleeper';
import { lineupSlots, teamScore, topTrades, tradeBoard, tradesBetween, valuedRosters, type Trade, type ValuedPlayer } from '../src/lib/trades';

const load = <T>(name: string): T => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const SLOTS = lineupSlots(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF', 'BN', 'BN']);
const p = (id: string, pos: string, value: number): ValuedPlayer => ({ id, pos, value });

test('lineup slots skip kickers, defenses, and bench, with flex last', () => {
  expect(SLOTS.map(s => s.join('/'))).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB/WR/TE', 'RB/WR/TE']);
});

test('team score fills starters first and counts the bench a little', () => {
  const qb = p('q', 'QB', 1000);
  const qb2 = p('q2', 'QB', 900);
  // One QB slot: the backup QB sits on the bench at 10%.
  expect(teamScore([qb, qb2], SLOTS)).toBe(1000 + 90);
  // A WR fills a FLEX once both WR slots are taken.
  const wrs = [p('w1', 'WR', 500), p('w2', 'WR', 400), p('w3', 'WR', 300)];
  expect(teamScore(wrs, SLOTS)).toBe(1200);
});

test('suggests a swap that fixes both teams, not one that only helps one side', () => {
  // A has two good QBs and no TE. B has two good TEs and no QB.
  const a = { rosterId: 1, players: [p('qa', 'QB', 3000), p('qa2', 'QB', 2900), p('ta', 'TE', 100)] };
  const b = { rosterId: 2, players: [p('qb', 'QB', 100), p('tb', 'TE', 3000), p('tb2', 'TE', 2800)] };
  const [best] = tradesBetween(a, b, SLOTS);
  expect(best!.aGets.some(id => id.startsWith('tb'))).toBe(true);
  expect(best!.bGets.some(id => id.startsWith('qa'))).toBe(true);
  expect(best!.aGain).toBeGreaterThan(0);
  expect(best!.bGain).toBeGreaterThan(0);
});

test('skips trades where the values are far apart', () => {
  const a = { rosterId: 1, players: [p('qa', 'QB', 3000), p('qa2', 'QB', 2900)] };
  const b = { rosterId: 2, players: [p('tb', 'TE', 3000), p('tb2', 'TE', 1000)] };
  // qa2 (2900) for tb2 (1000) helps both lineups but is lopsided.
  expect(tradesBetween(a, b, SLOTS).some(t => t.aGets.includes('tb2') && t.aGets.length === 1)).toBe(false);
});

test('topTrades drops a trade that is a better one plus a throw in', () => {
  const t = (aGets: string[], bGets: string[]): Trade => ({ a: 1, b: 2, aGets, bGets, aGain: 0.1, bGain: 0.1, aGetsValue: 1, bGetsValue: 1 });
  const kept = topTrades([t(['x'], ['y']), t(['x', 'z'], ['y']), t(['w'], ['y'])], 5);
  expect(kept.map(k => k.aGets)).toEqual([['x'], ['w']]);
});

test('board on the week 4 league with sample values', () => {
  const league = load<League>('league');
  const values = valueMap(load<FcValue[]>('fantasycalc-values.sample'), false);
  const teams = valuedRosters(load<Roster[]>('rosters'), values);
  const board = tradeBoard(teams, league.roster_positions);
  expect(board.pairs.size).toBe(66);
  expect(board.byTeam.size).toBe(12);
  for (const trades of [...board.pairs.values(), ...board.byTeam.values()]) {
    for (const t of trades) {
      expect(t.aGain).toBeGreaterThan(0);
      expect(t.bGain).toBeGreaterThan(0);
      expect(Math.abs(t.aGetsValue - t.bGetsValue)).toBeLessThanOrEqual(0.15 * Math.max(t.aGetsValue, t.bGetsValue));
    }
  }
  // Every byTeam list is from that team's side, with at most two trades per partner.
  for (const [id, trades] of board.byTeam) {
    expect(trades.every(t => t.a === id)).toBe(true);
    for (const t of trades) expect(trades.filter(u => u.b === t.b).length).toBeLessThanOrEqual(2);
  }
});
