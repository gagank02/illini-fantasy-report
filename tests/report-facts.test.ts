import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import players from '../src/data/players.json';
import { assembleFacts, optimalLineup, type FactsInput, type Transaction } from '../src/lib/report-facts';
import type { League, Matchup, Roster, User } from '../src/lib/sleeper';
import type { Players } from '../src/lib/stats';

const load = <T>(name: string): T => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const P = players as Players;
const league = load<League>('league');
const users = load<User[]>('users');
const rosters = load<Roster[]>('rosters');
const weeks = [1, 2, 3, 4].map(w => load<Matchup[]>(`matchups-${w}`));
const input = (week: number, transactions: Transaction[] = load<Transaction[]>(`transactions-${week}`)): FactsInput => ({
  league, users, rosters, players: P, week,
  weeks: weeks.slice(0, week),
  transactions,
  nextWeek: week === 4 ? load<Matchup[]>('matchups-5') : weeks[week]!,
  trending: { add: load('trending-add'), drop: load('trending-drop') },
});
const facts = assembleFacts(input(4));
const teamNames = new Set(users.map(u => u.metadata.team_name || u.display_name));

describe('optimalLineup', () => {
  const fake: Players = Object.fromEntries(
    [['a', 'QB'], ['b', 'QB'], ['c', 'RB'], ['d', 'RB'], ['e', 'RB'], ['f', 'WR'], ['g', 'WR'], ['h', 'WR'], ['i', 'TE'], ['j', 'DEF']]
      .map(([id, pos]) => [id, { name: id!, pos: pos!, team: null, injury: null }]),
  );
  const points = { a: 20, b: 25, c: 10, d: 8, e: 15, f: 12, g: 3, h: 9, i: 7, j: 5 };
  const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF', 'BN', 'BN'];
  const best = optimalLineup(slots, points, fake);

  test('picks the best player for each slot, then FLEX from what is left', () => {
    expect(best.total).toBe(94);
    expect(best.lineup.find(s => s.slot === 'QB')!.id).toBe('b');
    expect(best.lineup.filter(s => s.slot === 'FLEX').map(s => s.id).sort()).toEqual(['d', 'g']);
  });

  test('matches Sleeper\'s own potential points (ppts) for every team over weeks 1 to 4', () => {
    for (const r of rosters as (Roster & { settings: { ppts: number; ppts_decimal: number } })[]) {
      const ours = weeks.reduce((s, wk) => s + optimalLineup(league.roster_positions, wk.find(m => m.roster_id === r.roster_id)!.players_points!, P).total, 0);
      expect(ours).toBeCloseTo(r.settings.ppts + r.settings.ppts_decimal / 100, 2);
    }
  });

  test('a QB never fills FLEX, an empty slot scores 0, bench slots are ignored', () => {
    expect(best.lineup.some(s => s.slot === 'FLEX' && s.id === 'a')).toBe(false);
    expect(best.lineup.find(s => s.slot === 'K')).toEqual({ slot: 'K', id: null, points: 0 });
    expect(best.lineup.some(s => s.slot === 'BN')).toBe(false);
  });
});

describe('assembleFacts (week 4 fixtures)', () => {
  test('one game per matchup, winner first, with top and bottom starters', () => {
    expect(facts.games).toHaveLength(6);
    for (const g of facts.games) {
      expect(g.winner.points).toBeGreaterThanOrEqual(g.loser.points);
      expect(g.margin).toBeCloseTo(g.winner.points - g.loser.points, 2);
      expect(g.winner.top.points).toBeGreaterThanOrEqual(g.winner.bottom.points);
    }
    const m = weeks[3]!.find(x => x.points === 167.68)!;
    expect(facts.games.find(g => g.winner.points === 167.68)!.winner.top.points).toBe(Math.max(...m.starters_points));
  });

  test('bench blunders: best lineup is never worse than the real one, and "could have won" is exact', () => {
    expect(facts.benchBlunders).toHaveLength(12);
    for (const b of facts.benchBlunders) {
      expect(b.optimal).toBeGreaterThanOrEqual(b.actual - 0.01);
      expect(b.leftOnBench).toBeCloseTo(b.optimal - b.actual, 2);
      expect(b.couldHaveWon).toBe(b.lost && b.optimal > b.opponentPoints);
    }
    const sorted = [...facts.benchBlunders].sort((a, b) => b.leftOnBench - a.leftOnBench);
    expect(facts.benchBlunders).toEqual(sorted);
    expect(facts.worstCoach.team).toBe(sorted[0]!.team);
    expect(facts.coachOfTheWeek.team).toBe(sorted.at(-1)!.team);
  });

  test('standings change compares with the week before', () => {
    expect(facts.standings).toHaveLength(12);
    expect(facts.standings.map(s => s.rank)).toEqual([...Array(12).keys()].map(i => i + 1));
    expect(facts.standings.reduce((s, r) => s + r.change, 0)).toBe(0);
  });

  test('power movers are real risers and fallers', () => {
    for (const r of facts.powerMovers.risers) expect(r.move).toBeGreaterThan(0);
    for (const f of facts.powerMovers.fallers) expect(f.move).toBeLessThan(0);
  });

  test('only completed transactions from this week, with player names', () => {
    const tx3 = load<Transaction[]>('transactions-3');
    const out = assembleFacts(input(3, tx3)).transactions;
    expect(out).toHaveLength(tx3.filter(t => t.status === 'complete' && t.leg === 3).length);
    for (const t of out) {
      expect(teamNames.has(t.team)).toBe(true);
      expect([...t.added, ...t.dropped].every(n => typeof n === 'string' && n.length > 0)).toBe(true);
    }
  });

  test('flags a player dropped this week or last who scored 15+ as someone else\'s starter', () => {
    const starter = weeks[3]!.find(m => m.points === 167.68)!;
    const i = starter.starters_points.findIndex(p => p >= 15);
    const other = rosters.find(r => r.roster_id !== starter.roster_id)!.roster_id;
    const tx: Transaction[] = [{ type: 'free_agent', status: 'complete', adds: null, drops: { [starter.starters[i]!]: other }, roster_ids: [other], leg: 3 }];
    const flagged = assembleFacts(input(4, tx)).droppedAndScored;
    expect(flagged).toEqual([expect.objectContaining({ player: P[starter.starters[i]!]!.name, points: starter.starters_points[i] })]);
  });

  test('injury report lists only this week\'s starters with a status', () => {
    const started = new Set(weeks[3]!.flatMap(m => m.starters));
    const byName = new Map(Object.entries(P).map(([id, p]) => [p.name, id]));
    for (const inj of facts.injuries) {
      expect(inj.status).toBeTruthy();
      expect(started.has(byName.get(inj.player)!)).toBe(true);
    }
  });

  test('next week has every team exactly once', () => {
    expect(facts.nextWeek).toHaveLength(6);
    const teams = facts.nextWeek.flatMap(g => [g.home.team, g.away.team]);
    expect(new Set(teams).size).toBe(12);
  });

  test('trending players resolve to names', () => {
    expect(facts.trending.adds.length).toBeGreaterThan(0);
    for (const t of [...facts.trending.adds, ...facts.trending.drops]) expect(t.name).toBeTruthy();
  });

  test('the bundle is plain JSON and names only real teams', () => {
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
    for (const g of facts.games) for (const side of [g.winner, g.loser]) expect(teamNames.has(side.team)).toBe(true);
  });
});
