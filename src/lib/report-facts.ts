// The facts bundle: everything the weekly report writer may cite, computed and tested here.
// Records are numbers (wins, losses, ties), never "3-1", so the writer can't copy a dash.
import {
  currentLeagueId, loadSeason, trending, weekMatchups, weekTransactions,
  type League, type Matchup, type Roster, type Transaction, type User,
} from './sleeper.ts';
import { facts, games, powerRankings, standings, teamNames, type Players } from './stats.ts';

export type { Transaction };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which player positions can fill each lineup slot. Slots not listed (BN, IR, TAXI) are ignored. */
const ELIGIBLE: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

/**
 * Best possible lineup from a roster's points. Fills the most restrictive slots first (QB, RB, ... then FLEX),
 * each with the highest scoring eligible player left.
 * ponytail: greedy is exact for this league's slots (FLEX = RB/WR/TE); unusual mixes of overlapping flex
 * slots could need a proper assignment solver.
 */
export function optimalLineup(slots: string[], points: Record<string, number>, players: Players) {
  const used = new Set<string>();
  const filled: { i: number; slot: string; id: string | null; points: number }[] = [];
  const order = slots.map((slot, i) => ({ slot, i })).filter(s => ELIGIBLE[s.slot])
    .sort((a, b) => ELIGIBLE[a.slot]!.length - ELIGIBLE[b.slot]!.length);
  for (const { slot, i } of order) {
    let best: string | null = null;
    for (const [id, pts] of Object.entries(points)) {
      if (used.has(id) || !ELIGIBLE[slot]!.includes(players[id]?.pos ?? '')) continue;
      if (best === null || pts > points[best]!) best = id;
    }
    if (best) used.add(best);
    filled.push({ i, slot, id: best, points: best ? points[best]! : 0 });
  }
  const lineup = filled.sort((a, b) => a.i - b.i).map(({ slot, id, points }) => ({ slot, id, points }));
  return { total: round2(lineup.reduce((s, x) => s + x.points, 0)), lineup };
}

export interface FactsInput {
  league: League;
  users: User[];
  rosters: Roster[];
  players: Players;
  /** Final regular season weeks 1..week. */
  weeks: Matchup[][];
  week: number;
  /** Transactions from last week and this week. */
  transactions: Transaction[];
  nextWeek: Matchup[];
  trending: { add: { player_id: string; count: number }[]; drop: { player_id: string; count: number }[] };
}

export type ReportFacts = ReturnType<typeof assembleFacts>;

export function assembleFacts(input: FactsInput) {
  const { league, users, rosters, players, weeks, week } = input;
  const thisWeek = weeks[week - 1] ?? [];
  const who = (rosterId: number) => {
    const r = rosters.find(x => x.roster_id === rosterId);
    return r ? teamNames(users, r.owner_id) : { team: `Team ${rosterId}`, manager: 'Unknown' };
  };
  const player = (id: string, pts: number) => ({ name: players[id]?.name ?? id, pos: players[id]?.pos ?? '?', points: pts });
  const pairs = (ms: Matchup[]) =>
    Object.values(Object.groupBy(ms.filter(m => m.matchup_id != null), m => String(m.matchup_id))).map(p => [...p!]);

  const all = games(weeks);
  const rows = standings(rosters, users, all);
  const before = standings(rosters, users, games(weeks.slice(0, week - 1)));
  const power = powerRankings(all, week);

  const side = (m: Matchup) => {
    const starters = m.starters.map((id, i) => player(id, m.starters_points[i] ?? 0)).filter(p => p.name !== '0');
    const byPts = [...starters].sort((a, b) => b.points - a.points);
    return { ...who(m.roster_id), points: m.points, top: byPts[0]!, bottom: byPts.at(-1)! };
  };
  const gameList = pairs(thisWeek)
    .filter(p => p.length === 2)
    .map(p => p.sort((a, b) => b.points - a.points))
    .map(([w, l]) => ({ winner: side(w!), loser: side(l!), margin: round2(w!.points - l!.points) }));

  const benchBlunders = thisWeek
    .filter(m => m.matchup_id != null)
    .map(m => {
      const opp = thisWeek.find(o => o.matchup_id === m.matchup_id && o.roster_id !== m.roster_id);
      const best = optimalLineup(league.roster_positions, m.players_points ?? {}, players);
      const bench = (m.players ?? []).filter(id => !m.starters.includes(id))
        .map(id => player(id, m.players_points?.[id] ?? 0)).sort((a, b) => b.points - a.points);
      const lost = !!opp && m.points < opp.points;
      return {
        ...who(m.roster_id),
        actual: m.points,
        optimal: best.total,
        leftOnBench: round2(best.total - m.points),
        opponentPoints: opp?.points ?? 0,
        lost,
        couldHaveWon: lost && best.total > (opp?.points ?? 0),
        bestBenchPlayer: bench[0] ?? null,
      };
    })
    .sort((a, b) => b.leftOnBench - a.leftOnBench);

  const completed = input.transactions.filter(t => t.status === 'complete');
  const names = (ids: Record<string, number> | null) => Object.keys(ids ?? {}).map(id => players[id]?.name ?? id);

  const droppedAndScored = completed
    .filter(t => t.leg === week || t.leg === week - 1)
    .flatMap(t => Object.entries(t.drops ?? {}))
    .flatMap(([id, droppedBy]) =>
      thisWeek
        .filter(m => m.roster_id !== droppedBy && m.starters.includes(id))
        .map(m => ({ id, m, pts: m.starters_points[m.starters.indexOf(id)] ?? 0 }))
        .filter(x => x.pts >= 15)
        .map(x => ({ player: players[id]?.name ?? id, points: x.pts, droppedBy: who(droppedBy).team, startedFor: who(x.m.roster_id).team })),
    );

  const injuries = thisWeek.flatMap(m =>
    m.starters.filter(id => players[id]?.injury).map(id => ({
      player: players[id]!.name, pos: players[id]!.pos, status: players[id]!.injury!, ...who(m.roster_id),
    })),
  );

  const nextSide = (m: Matchup) => {
    const row = rows.find(r => r.rosterId === m.roster_id);
    const pr = power.find(p => p.rosterId === m.roster_id);
    return { ...who(m.roster_id), wins: row?.w ?? 0, losses: row?.l ?? 0, ties: row?.t ?? 0, last3: pr?.last3 ?? 0, powerRank: pr?.rank ?? null };
  };
  // Who in our league rosters each player RIGHT NOW (null = free agent here). Trending is the last 24 hours,
  // so ownership must be current too: last week's games miss this week's waiver pickups.
  const owner = new Map(rosters.flatMap(r => (r.players ?? []).map(id => [id, r.roster_id] as const)));
  const trend = (list: { player_id: string; count: number }[]) =>
    list.filter(t => players[t.player_id]).map(t => {
      const rid = owner.get(t.player_id);
      return {
        name: players[t.player_id]!.name, pos: players[t.player_id]!.pos, nflTeam: players[t.player_id]!.team, count: t.count,
        rosteredBy: rid ? who(rid).team : null,
      };
    });

  return {
    season: Number(league.season),
    week,
    games: gameList,
    benchBlunders,
    coachOfTheWeek: benchBlunders.at(-1)!,
    worstCoach: benchBlunders[0]!,
    standings: rows.map(r => ({
      rank: r.rank, team: r.team, manager: r.manager, wins: r.w, losses: r.l, ties: r.t, pointsFor: r.pf, pointsAgainst: r.pa,
      change: week > 1 ? before.find(b => b.rosterId === r.rosterId)!.rank - r.rank : 0,
    })),
    powerMovers: {
      risers: power.filter(p => (p.move ?? 0) > 0).sort((a, b) => b.move! - a.move!).slice(0, 3)
        .map(p => ({ ...who(p.rosterId), rank: p.rank, move: p.move!, score: p.score, last3: p.last3 })),
      fallers: power.filter(p => (p.move ?? 0) < 0).sort((a, b) => a.move! - b.move!).slice(0, 3)
        .map(p => ({ ...who(p.rosterId), rank: p.rank, move: p.move!, score: p.score, last3: p.last3 })),
    },
    aroundTheLeague: facts(rows, all).map(f => f.text),
    transactions: completed.filter(t => t.leg === week).map(t => ({
      type: t.type, team: who(t.roster_ids[0]!).team, teams: t.roster_ids.map(id => who(id).team),
      added: names(t.adds), dropped: names(t.drops),
    })),
    droppedAndScored,
    injuries,
    nextWeek: pairs(input.nextWeek).filter(p => p.length === 2).map(([a, b]) => ({ home: nextSide(a!), away: nextSide(b!) })),
    trending: { adds: trend(input.trending.add), drops: trend(input.trending.drop) },
  };
}

/** Fetches what assembleFacts needs (about 5 Sleeper calls beyond loadSeason) and builds the bundle. */
export async function buildFacts(week: number, players: Players, leagueId = currentLeagueId()): Promise<ReportFacts> {
  const season = await loadSeason(leagueId);
  if (week < 1 || week > season.weeks.length) {
    throw new Error(`Week ${week} is not final yet. Final regular season weeks: 1 to ${season.weeks.length}.`);
  }
  const [lastTx, thisTx, nextWeek, add, drop] = await Promise.all([
    week > 1 ? weekTransactions(week - 1, leagueId) : Promise.resolve([]),
    weekTransactions(week, leagueId),
    weekMatchups(week + 1, leagueId).catch(() => []),
    trending('add'),
    trending('drop'),
  ]);
  return assembleFacts({
    ...season, players, week, weeks: season.weeks.slice(0, week),
    transactions: [...lastTx, ...thisTx], nextWeek, trending: { add, drop },
  });
}
