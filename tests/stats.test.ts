import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { regularSeasonWeeks, type League, type Matchup, type Roster, type User } from '../src/lib/sleeper';
import { games, ordinal, rankBy, recordWithSchedule, standings, streak, whatIfMatrix } from '../src/lib/stats';

const load = <T>(name: string): T => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const league = load<League>('league');
const users = load<User[]>('users');
const rosters = load<Roster[]>('rosters');
const weeks = [1, 2, 3, 4].map(w => load<Matchup[]>(`matchups-${w}`));

describe('regularSeasonWeeks', () => {
  test('stops at the last scored week during the season', () => {
    expect(regularSeasonWeeks(league)).toBe(4);
  });
  test('stops before the playoffs once the season is over', () => {
    expect(regularSeasonWeeks({ ...league, settings: { ...league.settings, last_scored_leg: 17 } })).toBe(14);
  });
});

describe('games', () => {
  const g = games(weeks);
  test('every team plays once a week', () => {
    expect(g).toHaveLength(12 * 4);
  });
  test('opponents are symmetric', () => {
    for (const a of g) {
      const b = g.find(x => x.week === a.week && x.rosterId === a.opponentId)!;
      expect(b.opponentId).toBe(a.rosterId);
      expect(b.points).toBe(a.opponentPoints);
    }
  });
  test('skips teams with no matchup (byes, playoff weeks)', () => {
    const week = [...weeks[0]!.slice(0, 2), { roster_id: 99, matchup_id: null, points: 0, starters: [], starters_points: [] }];
    expect(games([week]).map(x => x.rosterId)).not.toContain(99);
  });
});

describe('standings', () => {
  const rows = standings(rosters, users, games(weeks));

  test('matches Sleeper record, points, and streak for every team', () => {
    for (const r of rosters) {
      const row = rows.find(x => x.rosterId === r.roster_id)!;
      const s = r.settings;
      expect([row.w, row.l, row.t]).toEqual([s.wins, s.losses, s.ties]);
      expect(row.pf).toBeCloseTo(s.fpts + s.fpts_decimal / 100, 2);
      expect(row.pa).toBeCloseTo(s.fpts_against + s.fpts_against_decimal / 100, 2);
      expect(row.record).toBe(r.metadata.record);
      expect(row.streak).toBe(r.metadata.streak);
    }
  });

  test('sorted by wins, then points for', () => {
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1]!, rows[i]!];
      expect(a.w > b.w || (a.w === b.w && a.pf >= b.pf)).toBe(true);
      expect(b.rank).toBe(i + 1);
    }
  });

  test('uses team name, falling back to display name', () => {
    const row = rows.find(x => x.rosterId === rosters[0]!.roster_id)!;
    const user = users.find(u => u.user_id === rosters[0]!.owner_id)!;
    expect(row.manager).toBe(user.display_name);
    expect(row.team).toBe(user.metadata.team_name ?? user.display_name);
    const noName = standings(rosters, users.map(u => ({ ...u, metadata: {} })), games(weeks));
    expect(noName.find(x => x.rosterId === row.rosterId)!.team).toBe(user.display_name);
  });

  test('a tie counts as half a win for sorting', () => {
    const tied = [[
      { roster_id: 1, matchup_id: 1, points: 100, starters: [], starters_points: [] },
      { roster_id: 2, matchup_id: 1, points: 100, starters: [], starters_points: [] },
      { roster_id: 3, matchup_id: 2, points: 50, starters: [], starters_points: [] },
      { roster_id: 4, matchup_id: 2, points: 60, starters: [], starters_points: [] },
    ]];
    const rs = [1, 2, 3, 4].map(id => ({ ...rosters[0]!, roster_id: id }));
    const out = standings(rs, users, games(tied));
    expect(out.map(r => r.rosterId)).toEqual([4, 1, 2, 3]);
    expect(out[1]!.t).toBe(1);
    expect(out[1]!.streak).toBe('1T');
  });
});

describe('streak', () => {
  test.each([
    ['WLWW', '2W'],
    ['WWWL', '1L'],
    ['LLL', '3L'],
    ['WT', '1T'],
    ['', ''],
  ])('%s → %s', (record, want) => {
    expect(streak(record)).toBe(want);
  });
});

describe('rankBy', () => {
  test('highest value is rank 1, ties share a rank', () => {
    expect(rankBy([10, 30, 20, 30])).toEqual([4, 1, 3, 1]);
  });
});

describe('PF and PA ranks in standings', () => {
  const rows = standings(rosters, users, games(weeks));
  test('rank 1 has the most points for and the most points against', () => {
    const maxPf = Math.max(...rows.map(r => r.pf));
    const maxPa = Math.max(...rows.map(r => r.pa));
    expect(rows.find(r => r.pfRank === 1)!.pf).toBe(maxPf);
    expect(rows.find(r => r.paRank === 1)!.pa).toBe(maxPa);
  });
  test('every team gets a rank from 1 to 12', () => {
    for (const r of rows) {
      expect(r.pfRank).toBeGreaterThanOrEqual(1);
      expect(r.paRank).toBeLessThanOrEqual(12);
    }
  });
});

describe('ordinal', () => {
  test.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd']])('%i → %s', (n, want) => {
    expect(ordinal(n)).toBe(want);
  });
});

describe('what if', () => {
  const all = games(weeks);
  const rows = standings(rosters, users, all);
  const m = (id: number, pts: number, opp: number) => ({ roster_id: id, matchup_id: opp, points: pts, starters: [], starters_points: [] });

  test('diagonal equals each team\'s actual record', () => {
    for (const r of rows) {
      const rec = recordWithSchedule(all, r.rosterId, r.rosterId);
      expect([rec.w, rec.l, rec.t]).toEqual([r.w, r.l, r.t]);
    }
  });

  test('uses the opponent B faced, and B\'s own score when B played A', () => {
    // Week 1: A(1) 100 vs B(2) 90, C(3) 120 vs D(4) 80.
    // Week 2: A(1) 70 vs C(3) 60, B(2) 110 vs D(4) 75.
    const g = games([
      [m(1, 100, 1), m(2, 90, 1), m(3, 120, 2), m(4, 80, 2)],
      [m(1, 70, 1), m(3, 60, 1), m(2, 110, 2), m(4, 75, 2)],
    ]);
    // A with B's schedule: week 1 B played A, so A faces B's score 90 (W). Week 2 B played D (75), A scored 70 (L).
    expect(recordWithSchedule(g, 1, 2)).toEqual({ w: 1, l: 1, t: 0 });
    // C with A's schedule: week 1 A played B (90), C 120 (W). Week 2 A played C, so C faces A's score 70, C 60 (L).
    expect(recordWithSchedule(g, 3, 1)).toEqual({ w: 1, l: 1, t: 0 });
  });

  test('equal scores count as a tie', () => {
    const g = games([[m(1, 100, 1), m(2, 90, 1), m(3, 100, 2), m(4, 80, 2)]]);
    // B faced A (100). Team 3 scored 100 → tie.
    expect(recordWithSchedule(g, 3, 2)).toEqual({ w: 0, l: 0, t: 1 });
  });

  test('matrix is square, in standings order, with the diagonal marked', () => {
    const matrix = whatIfMatrix(rows, all);
    expect(matrix.map(r => r.rosterId)).toEqual(rows.map(r => r.rosterId));
    for (const [i, row] of matrix.entries()) {
      expect(row.cells.map(c => c.rosterId)).toEqual(rows.map(r => r.rosterId));
      expect(row.cells[i]!.w).toBe(rows[i]!.w);
      expect(row.best.w).toBeGreaterThanOrEqual(row.cells[i]!.w);
      expect(row.worst.w).toBeLessThanOrEqual(row.cells[i]!.w);
    }
  });
});
