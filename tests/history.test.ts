import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildHistory, championRun, draftBoard, draftValue, playerName, playoffRounds, walkChain, type BracketMatch, type DraftPick, type SeasonData } from '../src/lib/history';
import type { League, Matchup, Roster, User } from '../src/lib/sleeper';
import { games, standings } from '../src/lib/stats';

const load = <T>(path: string): T => JSON.parse(readFileSync(`tests/fixtures/${path}.json`, 'utf8'));
const past = (year: string, weeks: number): SeasonData => ({
  league: load<League>(`history/${year}/league`),
  users: load<User[]>(`history/${year}/users`),
  rosters: load<Roster[]>(`history/${year}/rosters`),
  weeks: Array.from({ length: weeks }, (_, i) => load<Matchup[]>(`history/${year}/matchups-${i + 1}`)),
  bracket: load<BracketMatch[]>(`history/${year}/winners_bracket`),
  playoffWeeks: [15, 16, 17].map(w => load<Matchup[]>(`history/${year}/matchups-${w}`)),
});
const current: SeasonData = {
  league: load<League>('league'),
  users: load<User[]>('users'),
  rosters: load<Roster[]>('rosters'),
  weeks: [1, 2, 3, 4].map(w => load<Matchup[]>(`matchups-${w}`)),
  bracket: null,
  playoffWeeks: [],
};
const seasons = [current, past('2025', 14), past('2024', 14)];
const h = buildHistory(seasons);
const ownerOf = (s: SeasonData, rosterId: number) => s.rosters.find(r => r.roster_id === rosterId)!.owner_id;

describe('walkChain', () => {
  const leagues: Record<string, Partial<League>> = {
    c: { league_id: 'c', season: '2026', previous_league_id: 'b' },
    b: { league_id: 'b', season: '2025', previous_league_id: 'a' },
    a: { league_id: 'a', season: '2024', previous_league_id: null },
    x: { league_id: 'x', season: '2026', previous_league_id: 'y' },
    y: { league_id: 'y', season: '2025', previous_league_id: 'x' },
  };
  const fetchLeague = async (id: string) => leagues[id] as League;

  test('follows previous_league_id back to the first season, newest first', async () => {
    expect((await walkChain('c', fetchLeague)).map(l => l.season)).toEqual(['2026', '2025', '2024']);
  });
  test('stops on a repeated league id instead of looping', async () => {
    expect((await walkChain('x', fetchLeague)).map(l => l.league_id)).toEqual(['x', 'y']);
  });
  test('stops after the max number of seasons', async () => {
    const endless = async (id: string) => ({ league_id: id, season: id, previous_league_id: String(Number(id) - 1) }) as League;
    expect(await walkChain('100', endless, 30)).toHaveLength(30);
  });
});

describe('buildHistory', () => {
  test('champions and runners up come from the winners bracket final', () => {
    const s2025 = h.seasons.find(s => s.season === 2025)!;
    const s2024 = h.seasons.find(s => s.season === 2024)!;
    expect(s2025.champion!.userId).toBe(ownerOf(seasons[1]!, 6));
    expect(s2024.champion!.userId).toBe(ownerOf(seasons[2]!, 3));
    expect(s2024.runnerUp!.userId).toBe(ownerOf(seasons[2]!, 8));
  });

  test('the punishment loser is last in the regular season standings', () => {
    for (const s of h.seasons.filter(x => !x.inProgress)) {
      expect(s.punishment!.userId).toBe(s.standings.at(-1)!.userId);
    }
  });

  test('the season in progress has standings but no champion or punishment yet', () => {
    const s2026 = h.seasons.find(s => s.season === 2026)!;
    expect(s2026.inProgress).toBe(true);
    expect(s2026.champion).toBeNull();
    expect(s2026.punishment).toBeNull();
    expect(s2026.standings).toHaveLength(12);
  });

  test('all time wins equal the sum of Sleeper season wins, across 10 and 12 team seasons', () => {
    for (const m of h.managers) {
      const sleeperWins = seasons.reduce((sum, s) => sum + (s.rosters.find(r => r.owner_id === m.userId)?.settings.wins ?? 0), 0);
      expect(m.w).toBe(sleeperWins);
    }
    expect(h.managers).toHaveLength(12);
  });

  test('win % is rounded to three decimals', () => {
    for (const m of h.managers) expect(m.pct).toBe(Math.round(((m.w + m.t / 2) / (m.w + m.l + m.t)) * 1000) / 1000);
    expect(h.managers.every(m => String(m.pct).length <= 5)).toBe(true);
  });

  test('seasons played counts late joiners correctly', () => {
    expect(h.managers.filter(m => m.seasons === 3)).toHaveLength(10);
    expect(h.managers.filter(m => m.seasons === 2)).toHaveLength(2);
  });

  test('one title and one punishment per completed season; playoff spots match bracket size', () => {
    expect(h.managers.reduce((s, m) => s + m.titles, 0)).toBe(2);
    expect(h.managers.reduce((s, m) => s + m.punishments, 0)).toBe(2);
    expect(h.managers.reduce((s, m) => s + m.playoffs, 0)).toBe(12); // 6 playoff teams x 2 seasons
  });

  test('head to head is symmetric and adds up to each manager\'s all time record', () => {
    for (const a of h.managers) {
      let w = 0;
      for (const b of h.managers) {
        if (a.userId === b.userId) continue;
        const ab = h.h2h[a.userId]?.[b.userId] ?? { w: 0, l: 0, t: 0 };
        const ba = h.h2h[b.userId]?.[a.userId] ?? { w: 0, l: 0, t: 0 };
        expect([ab.w, ab.l, ab.t]).toEqual([ba.l, ba.w, ba.t]);
        w += ab.w;
      }
      expect(w).toBe(a.w);
    }
  });

  test('records book: highest and lowest scores are the true extremes', () => {
    const all = seasons.flatMap(s => s.weeks.flatMap((wk, i) => wk.filter(m => m.matchup_id != null).map(m => ({ p: m.points, week: i + 1, season: Number(s.league.season) }))));
    const max = all.reduce((a, b) => (b.p > a.p ? b : a));
    const min = all.reduce((a, b) => (b.p < a.p ? b : a));
    expect(h.records.highScore).toMatchObject({ value: max.p, season: max.season, week: max.week });
    expect(h.records.lowScore).toMatchObject({ value: min.p, season: min.season, week: min.week });
    expect(h.records.blowout.margin).toBeGreaterThan(0);
    const runs = (c: string) => Math.max(...seasons.flatMap(s => standings(s.rosters, s.users, games(s.weeks)).map(r => Math.max(0, ...(r.record.match(new RegExp(`${c}+`, 'g')) ?? []).map(x => x.length)))));
    expect(h.records.longestWinStreak.n).toBe(runs('W'));
    expect(h.records.longestLosingStreak.n).toBe(runs('L'));
  });

  test('best and worst completed seasons by win rate', () => {
    expect(h.records.bestSeason.w).toBeGreaterThanOrEqual(h.records.worstSeason.w);
    expect([2024, 2025]).toContain(h.records.bestSeason.season);
  });
});

describe('season pages', () => {
  const picks25 = load<DraftPick[]>('history/2025/draft_picks');
  const picks24 = load<DraftPick[]>('history/2024/draft_picks');
  const team = (s: SeasonData) => (rosterId: number) => {
    const ownerId = s.rosters.find(r => r.roster_id === rosterId)!.owner_id;
    const u = s.users.find(x => x.user_id === ownerId)!;
    return u.metadata.team_name || u.display_name;
  };

  test('draft board: rounds by slots, 12 columns in 2025 and 10 in 2024, every pick named', () => {
    const b25 = draftBoard(picks25, team(seasons[1]!));
    const b24 = draftBoard(picks24, team(seasons[2]!));
    expect(b25.slots).toHaveLength(12);
    expect(b24.slots).toHaveLength(10);
    expect(b25.rounds).toHaveLength(15);
    for (const round of b25.rounds) for (const cell of round) expect(cell.name && cell.pos).toBeTruthy();
    // Cells carry the Sleeper player id, so a page can look the player up (injury tags).
    const first0 = picks25.find(p => p.pick_no === 1)!;
    expect(b25.rounds[0]![first0.draft_slot - 1]!.playerId).toBe(first0.player_id);
    // Column header is the team that drafted from that slot.
    const first = picks25.find(p => p.pick_no === 1)!;
    expect(b25.slots[first.draft_slot - 1]).toBe(team(seasons[1]!)(first.roster_id));
  });

  test('draft board labels each pick as round.pick and knows each round\'s direction', () => {
    const b = draftBoard(picks25, team(seasons[1]!));
    const first = picks25.find(p => p.pick_no === 1)!;
    expect(b.rounds[0]![first.draft_slot - 1]!.label).toBe('1.01');
    const p35 = picks25.find(p => p.pick_no === 35)!; // 12 team snake: round 3, 11th pick of the round
    expect(b.rounds[2]![p35.draft_slot - 1]!.label).toBe('3.11');
    expect(b.directions.slice(0, 4)).toEqual(['ltr', 'rtl', 'ltr', 'rtl']);
    for (const [i, row] of b.rounds.entries()) {
      const order = row.map(c => Number(c.label.split('.')[1]));
      expect(order).toEqual(b.directions[i] === 'ltr' ? [...order].sort((x, y) => x - y) : [...order].sort((x, y) => y - x));
    }
  });

  test('draft value is judged within each position, so late QBs do not dominate', () => {
    const v = draftValue(picks25, seasons[1]!.weeks);
    const pts = (id: string) => seasons[1]!.weeks.flat().reduce((sum, m) => sum + (m.players_points?.[id] ?? 0), 0);
    expect(v.all.find(x => x.pickNo === 1)!.points).toBeCloseTo(pts(picks25.find(p => p.pick_no === 1)!.player_id), 2);
    for (const x of v.all) {
      const samePos = v.all.filter(y => y.pos === x.pos);
      expect(x.posPick).toBe(samePos.filter(y => y.pickNo < x.pickNo).length + 1);
      expect(x.posFinish).toBe([...samePos].sort((a, b) => b.points - a.points || a.pickNo - b.pickNo).indexOf(x) + 1);
      expect(x.diff).toBe(x.posPick - x.posFinish);
    }
    expect(v.hits).toHaveLength(5);
    expect(v.busts).toHaveLength(5);
    expect(v.hits[0]!.diff).toBe(Math.max(...v.all.map(x => x.diff)));
    expect(v.busts[0]!.diff).toBe(Math.min(...v.all.map(x => x.diff)));
    expect(new Set(v.hits.map(x => x.pos)).size).toBeGreaterThan(1);
  });

  test('bracket: the path to the title by round, placement games apart, scores from the playoff weeks', () => {
    const s = seasons[1]!;
    const { rounds, placements } = playoffRounds(s.bracket!, team(s), s.playoffWeeks);
    expect(rounds.map(r => [r.label, r.matches.length])).toEqual([['Quarterfinals', 2], ['Semifinals', 2], ['Final', 1]]);
    const final = rounds[2]!.matches[0]!;
    expect(final.place).toBe(1);
    expect(final.teams.filter(t => t.won).map(t => t.name)).toEqual([team(s)(6)]);
    expect(final.teams.map(t => t.points)).toEqual([152.92, 96.34]);
    expect(placements.map(m => m.place)).toEqual([3, 5]);
    expect(rounds.flatMap(r => r.matches).every(m => m.teams.filter(t => t.won).length === 1)).toBe(true);
    // Without playoff weeks the bracket still draws, just without scores.
    expect(playoffRounds(s.bracket!, team(s)).rounds[2]!.matches[0]!.teams.map(t => t.points)).toEqual([null, null]);
  });
});

describe('championRun', () => {
  for (const s of [seasons[1]!, seasons[2]!]) {
    const year = s.league.season;
    const run = championRun(s)!;
    const final = s.bracket!.find(m => m.p === 1)!;

    test(`${year}: one row per week, 1 through the final, playoffs labeled by round`, () => {
      expect(run.rosterId).toBe(final.w);
      expect(run.schedule.map(r => r.week)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
      expect(run.schedule.slice(14).map(r => r.label)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
    });

    test(`${year}: the winning roster is the final's lineup and its starters add up to the score`, () => {
      const last = run.schedule.at(-1)!;
      expect(last.theirs!.rosterId).toBe(final.l);
      expect(last.result).toBe('W');
      expect(run.roster).toBe(last.mine);
      expect(run.roster.starters.map(x => x.slot)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF']);
      expect(run.roster.starters.reduce((sum, x) => sum + x.points, 0)).toBeCloseTo(run.roster.points, 2);
      expect(run.roster.bench.every(b => !run.roster.starters.some(x => x.playerId === b.playerId))).toBe(true);
    });

    test(`${year}: regular season rows match the champion's record in buildHistory`, () => {
      const regular = run.schedule.filter(r => !r.playoff);
      const row = h.seasons.find(x => x.season === Number(year))!.standings.find(x => x.userId === ownerOf(s, final.w!))!;
      const count = (c: string) => regular.filter(r => r.result === c).length;
      expect([count('W'), count('L'), count('T')]).toEqual([row.w, row.l, row.t]);
      for (const r of regular) expect(r.theirs!.rosterId).not.toBe(run.rosterId);
    });
  }

  test('playoff weeks stay out of every regular season record', () => {
    const without = buildHistory(seasons.map(s => ({ ...s, playoffWeeks: [] })));
    expect(without).toEqual(h);
  });

  test('a playoff bye has no opponent or result', () => {
    const s = seasons[1]!;
    const champ = s.bracket!.find(m => m.p === 1)!.w!;
    const byeWeek = s.playoffWeeks[0]!.map(m => (m.roster_id === champ ? { ...m, matchup_id: null } : m));
    const row = championRun({ ...s, playoffWeeks: [byeWeek, ...s.playoffWeeks.slice(1)] })!.schedule[14]!;
    expect(row).toMatchObject({ label: 'Quarterfinals', theirs: null, result: null });
    expect(row.mine.rosterId).toBe(champ);
  });

  test('no run while the season is in progress', () => {
    expect(championRun(current)).toBeNull();
  });

  test('player names fall back from the player list to the draft to the id, and "0" is an empty slot', () => {
    const pick = { round: 1, pick_no: 1, draft_slot: 1, roster_id: 1, player_id: '77', metadata: { first_name: 'Drafted', last_name: 'Guy' } };
    expect(playerName('0', {})).toBe('Empty');
    expect(playerName('77', { 77: { name: 'Listed Guy', pos: 'RB', team: null, injury: null } }, [pick])).toBe('Listed Guy');
    expect(playerName('77', {}, [pick])).toBe('Drafted Guy');
    expect(playerName('78', {}, [pick])).toBe('Player 78');
  });
});
