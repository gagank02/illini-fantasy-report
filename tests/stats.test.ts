import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { regularSeasonWeeks, type League, type Matchup, type Roster, type User } from '../src/lib/sleeper';
import players from './fixtures/players.json';
import { allPlay, facts, games, injuryTag, ordinal, siteIds, siteSubset, trimPlayers, scheduleLuck, positionPoints, positionRankings, POSITIONS, powerRankings, rankBy, recordWithSchedule, standings, streak, whatIfMatrix, type Players } from '../src/lib/stats';

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

describe('power rankings', () => {
  const all = games(weeks);
  const m = (id: number, pts: number, opp: number) => ({ roster_id: id, matchup_id: opp, points: pts, starters: [], starters_points: [] });

  test('all play compares each week against every other team', () => {
    const g = games([[m(1, 100, 1), m(2, 90, 1), m(3, 80, 2), m(4, 100, 2)]]);
    expect(allPlay(g, 1)).toEqual({ w: 2, l: 0, t: 1 });
    expect(allPlay(g, 3)).toEqual({ w: 0, l: 3, t: 0 });
  });

  test('all play over the real league: every team plays 11 per week, wins equal losses overall', () => {
    const recs = rosters.map(r => allPlay(all, r.roster_id));
    for (const r of recs) expect(r.w + r.l + r.t).toBe(11 * weeks.length);
    expect(recs.reduce((s, r) => s + r.w, 0)).toBe(recs.reduce((s, r) => s + r.l, 0));
  });

  test('a team best at everything scores 100, worst at everything scores 0', () => {
    const g = games([
      [m(1, 150, 1), m(2, 100, 1), m(3, 120, 2), m(4, 60, 2)],
      [m(1, 140, 1), m(3, 110, 1), m(2, 90, 2), m(4, 50, 2)],
    ]);
    const pr = powerRankings(g, 2);
    expect(pr[0]).toMatchObject({ rosterId: 1, rank: 1, score: 100 });
    expect(pr.at(-1)).toMatchObject({ rosterId: 4, rank: 4, score: 0 });
  });

  test('score follows 50% all play, 30% PF, 20% last 3 weeks', () => {
    const pr = powerRankings(all, weeks.length);
    const pfs = pr.map(r => r.pf), l3 = pr.map(r => r.last3);
    const norm = (x: number, xs: number[]) => (x - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs));
    for (const r of pr) {
      const pct = (r.allPlay.w + r.allPlay.t / 2) / (r.allPlay.w + r.allPlay.l + r.allPlay.t);
      expect(r.score).toBeCloseTo(100 * (0.5 * pct + 0.3 * norm(r.pf, pfs) + 0.2 * norm(r.last3, l3)), 1);
    }
    for (let i = 1; i < pr.length; i++) expect(pr[i - 1]!.score).toBeGreaterThanOrEqual(pr[i]!.score);
  });

  test('movement compares with the previous week; none in week 1', () => {
    const g = games([
      [m(1, 150, 1), m(2, 100, 1), m(3, 120, 2), m(4, 60, 2)],
      [m(1, 40, 1), m(2, 160, 1), m(3, 120, 2), m(4, 60, 2)],
    ]);
    expect(powerRankings(g, 1).every(r => r.move === null)).toBe(true);
    const wk2 = powerRankings(g, 2);
    const t2 = wk2.find(r => r.rosterId === 2)!;
    const t1 = wk2.find(r => r.rosterId === 1)!;
    expect(t2.move).toBeGreaterThan(0);
    expect(t1.move).toBeLessThan(0);
  });

  test('only counts weeks up to the requested week', () => {
    const wk1 = powerRankings(all, 1);
    for (const r of wk1) expect(r.allPlay.w + r.allPlay.l + r.allPlay.t).toBe(11);
  });
});

describe('positional rankings', () => {
  const P = players as Players;
  const pp = positionPoints(weeks, P);

  test('position points add up to each team\'s real weekly totals', () => {
    for (const r of rosters) {
      const total = weeks.flat().filter(m => m.roster_id === r.roster_id).reduce((s, m) => s + m.points, 0);
      const byPos = pp.find(x => x.rosterId === r.roster_id)!.points;
      expect(POSITIONS.reduce((s, pos) => s + byPos[pos], 0)).toBeCloseTo(total, 1);
    }
  });

  test('a WR in a FLEX slot counts as WR', () => {
    const flex = league.roster_positions.indexOf('FLEX');
    const m = weeks.flat().find(x => P[x.starters[flex]!]?.pos === 'WR')!;
    const fake = { ...m, starters: [m.starters[flex]!], starters_points: [m.starters_points[flex]!] };
    const out = positionPoints([[fake]], P)[0]!;
    expect(out.points.WR).toBe(m.starters_points[flex]);
    expect(out.points.RB + out.points.TE).toBe(0);
  });

  test('empty lineup slots ("0") and unknown players are skipped', () => {
    const fake = { roster_id: 1, matchup_id: 1, points: 10, starters: ['0', 'nobody', 'DET'], starters_points: [5, 3, 10] };
    expect(positionPoints([[fake]], P)[0]!.points).toMatchObject({ DEF: 10, QB: 0 });
  });

  test('movement compares with the rankings through the previous week', () => {
    const wk = (a: number, b: number) => [
      { roster_id: 1, matchup_id: 1, points: a, starters: ['DET'], starters_points: [a] },
      { roster_id: 2, matchup_id: 1, points: b, starters: ['CHI'], starters_points: [b] },
    ];
    const two = [wk(10, 5), wk(0, 20)];
    const now = positionRankings(positionPoints(two, P), 'DEF', positionPoints(two.slice(0, 1), P));
    expect(now.find(r => r.rosterId === 2)).toMatchObject({ rank: 1, move: 1 });
    expect(now.find(r => r.rosterId === 1)).toMatchObject({ rank: 2, move: -1 });
    expect(positionRankings(positionPoints(two.slice(0, 1), P), 'DEF').every(r => r.move === null)).toBe(true);
  });

  test('rankings per position are sorted with ranks 1..n', () => {
    for (const pos of POSITIONS) {
      const ranked = positionRankings(pp, pos);
      expect(ranked).toHaveLength(12);
      ranked.forEach((r, i) => {
        if (i) expect(ranked[i - 1]!.points).toBeGreaterThanOrEqual(r.points);
        expect(r.rank).toBeLessThanOrEqual(i + 1);
      });
    }
  });
});

describe('facts', () => {
  const all = games(weeks);
  const rows = standings(rosters, users, all);
  const f = facts(rows, all);
  const get = (kind: string) => f.find(x => x.kind === kind);

  test('returns 3 to 5 facts', () => {
    expect(f.length).toBeGreaterThanOrEqual(3);
    expect(f.length).toBeLessThanOrEqual(5);
  });

  test('highest single week score matches the max in the data', () => {
    const top = all.reduce((a, b) => (b.points > a.points ? b : a));
    expect(get('high')).toMatchObject({ rosterId: top.rosterId, week: top.week, value: top.points });
  });

  test('biggest blowout and closest game use the winning side', () => {
    const margins = all.filter(g => g.points > g.opponentPoints).map(g => g.points - g.opponentPoints);
    expect(get('blowout')!.value).toBeCloseTo(Math.max(...margins), 2);
    expect(get('close')!.value).toBeCloseTo(Math.min(...margins), 2);
  });

  test('most points against names the team with the highest PA', () => {
    const worst = rows.reduce((a, b) => (b.pa > a.pa ? b : a));
    expect(get('unlucky')).toMatchObject({ rosterId: worst.rosterId, value: worst.pa });
  });

  test('every fact names a team and a number', () => {
    for (const x of f) {
      expect(x.text).toContain(rows.find(r => r.rosterId === x.rosterId)!.team);
      expect(x.text).toMatch(/\d/);
    }
  });

  test('skips the win streak fact when no one has won 2 straight', () => {
    const wk1 = games(weeks.slice(0, 1));
    const out = facts(standings(rosters, users, wk1), wk1);
    expect(out.find(x => x.kind === 'streak')).toBeUndefined();
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

describe('scheduleLuck', () => {
  const all = games(weeks);
  const rows = standings(rosters, users, all);
  const luck = scheduleLuck(whatIfMatrix(rows, all));

  test('luck = actual wins minus average wins across every schedule', () => {
    const m = whatIfMatrix(rows, all);
    for (const [i, row] of m.entries()) {
      const avg = row.cells.reduce((s, c) => s + c.w + c.t / 2, 0) / row.cells.length;
      const actual = row.cells[i]!.w + row.cells[i]!.t / 2;
      const l = luck.find(x => x.rosterId === row.rosterId)!;
      expect(l.avgWins).toBeCloseTo(avg, 5);
      expect(l.luck).toBeCloseTo(actual - avg, 5);
    }
  });

  test('sorted luckiest first', () => {
    for (let i = 1; i < luck.length; i++) expect(luck[i - 1]!.luck).toBeGreaterThanOrEqual(luck[i]!.luck);
  });
});

describe('injuryTag', () => {
  test('short tags and levels for real Sleeper statuses', () => {
    expect(injuryTag('Questionable')).toEqual({ short: 'Q', long: 'Questionable', level: 'warn' });
    expect(injuryTag('Doubtful')).toEqual({ short: 'D', long: 'Doubtful', level: 'warn' });
    expect(injuryTag('Out')).toEqual({ short: 'OUT', long: 'Out', level: 'out' });
    expect(injuryTag('IR')).toEqual({ short: 'IR', long: 'Injured reserve', level: 'out' });
    expect(injuryTag('PUP')).toEqual({ short: 'PUP', long: 'Physically unable to perform', level: 'out' });
    expect(injuryTag('Sus')).toEqual({ short: 'SUS', long: 'Suspended', level: 'out' });
    expect(injuryTag('DNR')).toEqual({ short: 'DNR', long: 'Did not report', level: 'warn' });
  });
  test('Probable (in Sleeper\'s docs) gets a tag too', () => {
    expect(injuryTag('Probable')).toEqual({ short: 'P', long: 'Probable', level: 'warn' });
  });
  test('no tag for healthy, missing, or noise statuses', () => {
    for (const s of [null, undefined, '', 'NA', 'Healthy', 'whatever']) expect(injuryTag(s)).toBeNull();
  });
  test('every status in the saved player list is either tagged or deliberately skipped', () => {
    const seen = new Set(Object.values(players as Players).map(p => p.injury).filter(Boolean) as string[]);
    for (const s of seen) expect(injuryTag(s) !== null || s === 'NA').toBe(true);
  });
});

describe('trimPlayers', () => {
  const raw = {
    '1': { full_name: 'Hurt Guy', position: 'WR', team: 'CHI', injury_status: 'Out', injury_body_part: 'Hamstring' },
    '2': { full_name: 'Healthy Guy', position: 'RB', team: 'DET', injury_status: null, injury_body_part: 'Ankle' },
    '3': { first_name: 'No', last_name: 'Part', position: 'TE', team: null, injury_status: 'Questionable' },
    '4': { full_name: 'Lineman', position: 'OL', team: 'GB' },
  };
  const out = trimPlayers(raw);

  test('keeps fantasy positions only, with name, team, and injury', () => {
    expect(Object.keys(out)).toEqual(['1', '2', '3']);
    expect(out['3']).toEqual({ name: 'No Part', pos: 'TE', team: null, injury: 'Questionable' });
  });
  test('body part only for injured players, and only when Sleeper sends it', () => {
    expect(out['1']!.body).toBe('Hamstring');
    expect(out['2']!.body).toBeUndefined();
    expect(out['3']!.body).toBeUndefined();
  });
});

describe('site player subset (committed instead of Sleeper\'s full list)', () => {
  const all: Players = {
    a: { name: 'A', pos: 'QB', team: 'X', injury: null },
    b: { name: 'B', pos: 'RB', team: 'X', injury: 'Out', body: 'Knee' },
    c: { name: 'C', pos: 'WR', team: 'X', injury: null },
    z: { name: 'Z', pos: 'TE', team: 'X', injury: null },
  };
  test('keeps only the given ids that exist, sorted', () => {
    expect(siteSubset(all, ['c', 'b', 'missing', 'b'])).toEqual({ b: all.b, c: all.c });
  });
  test('ids come from rosters, every week\'s players and starters, and draft picks', () => {
    const ids = siteIds(
      [{ roster_id: 1, players: ['a'] }, { roster_id: 2, players: null }],
      [[{ roster_id: 1, matchup_id: 1, points: 0, starters: ['b', '0'], starters_points: [0, 0], players: ['b', 'c'] }]],
      [{ player_id: 'z' }],
    );
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'z']);
  });
});
