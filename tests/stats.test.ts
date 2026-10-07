import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { regularSeasonWeeks, type League, type Matchup, type Roster, type User } from '../src/lib/sleeper';
import { games, standings, streak } from '../src/lib/stats';

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
