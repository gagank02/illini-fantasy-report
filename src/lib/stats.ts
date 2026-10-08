// Pure league math. Plain data in, plain data out. No fetching here.
import type { Matchup, Roster, User } from './sleeper';

export interface Game {
  week: number;
  rosterId: number;
  points: number;
  opponentId: number;
  opponentPoints: number;
}

export type Result = 'W' | 'L' | 'T';

export interface StandingsRow {
  rank: number;
  rosterId: number;
  team: string;
  manager: string;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  /** 1 = most points for in the league. */
  pfRank: number;
  /** 1 = most points against in the league. */
  paRank: number;
  /** Results in week order, e.g. "WLWW". */
  record: string;
  /** e.g. "2W". */
  streak: string;
}

/** One entry per team per week. Teams without a matchup that week are skipped. */
export function games(weeks: Matchup[][]): Game[] {
  return weeks.flatMap((week, i) =>
    week.flatMap(m => {
      const opp = m.matchup_id == null ? undefined : week.find(o => o.matchup_id === m.matchup_id && o.roster_id !== m.roster_id);
      return opp ? [{ week: i + 1, rosterId: m.roster_id, points: m.points, opponentId: opp.roster_id, opponentPoints: opp.points }] : [];
    }),
  );
}

export function result(g: Pick<Game, 'points' | 'opponentPoints'>): Result {
  return g.points > g.opponentPoints ? 'W' : g.points < g.opponentPoints ? 'L' : 'T';
}

export function streak(record: string): string {
  const last = record.at(-1);
  if (!last) return '';
  let n = 0;
  for (let i = record.length - 1; i >= 0 && record[i] === last; i--) n++;
  return `${n}${last}`;
}

export function teamNames(users: User[], ownerId: string): { team: string; manager: string } {
  const u = users.find(x => x.user_id === ownerId);
  const manager = u?.display_name ?? 'Unknown';
  return { team: u?.metadata.team_name || manager, manager };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rank 1 = highest value. Ties share a rank (1, 2, 2, 4). */
export function rankBy(values: number[]): number[] {
  return values.map(v => values.filter(o => o > v).length + 1);
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return n + (teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
}

/** Sorted by win% (a tie counts as half a win), then points for. */
export function standings(rosters: Roster[], users: User[], all: Game[]): StandingsRow[] {
  return rosters
    .map(r => {
      const mine = all.filter(g => g.rosterId === r.roster_id).sort((a, b) => a.week - b.week);
      const record = mine.map(result).join('');
      return {
        rank: 0,
        rosterId: r.roster_id,
        ...teamNames(users, r.owner_id),
        w: mine.filter(g => result(g) === 'W').length,
        l: mine.filter(g => result(g) === 'L').length,
        t: mine.filter(g => result(g) === 'T').length,
        pf: round2(mine.reduce((s, g) => s + g.points, 0)),
        pa: round2(mine.reduce((s, g) => s + g.opponentPoints, 0)),
        pfRank: 0,
        paRank: 0,
        record,
        streak: streak(record),
      };
    })
    .sort((a, b) => b.w + b.t / 2 - (a.w + a.t / 2) || b.pf - a.pf)
    .map((row, i, rows) => ({
      ...row,
      rank: i + 1,
      pfRank: rankBy(rows.map(r => r.pf))[i]!,
      paRank: rankBy(rows.map(r => r.pa))[i]!,
    }));
}

export interface Record3 {
  w: number;
  l: number;
  t: number;
}

/**
 * Team `a`'s record if it had played team `b`'s schedule. Each week `a` faces whoever `b` faced.
 * If `b` faced `a`, `a` faces `b`'s score instead. With a === b this is the actual record.
 */
export function recordWithSchedule(all: Game[], a: number, b: number): Record3 {
  const rec = { w: 0, l: 0, t: 0 };
  for (const theirs of all.filter(g => g.rosterId === b)) {
    const mine = all.find(g => g.rosterId === a && g.week === theirs.week);
    if (!mine) continue;
    const opp = theirs.opponentId === a ? theirs.points : theirs.opponentPoints;
    const r = result({ points: mine.points, opponentPoints: opp });
    rec[r === 'W' ? 'w' : r === 'L' ? 'l' : 't']++;
  }
  return rec;
}

export interface WhatIfRow {
  rosterId: number;
  /** One cell per schedule, in standings order. */
  cells: (Record3 & { rosterId: number })[];
  best: Record3 & { rosterId: number };
  worst: Record3 & { rosterId: number };
}

const winPct = (r: Record3) => r.w + r.t / 2;

export function whatIfMatrix(rows: StandingsRow[], all: Game[]): WhatIfRow[] {
  return rows.map(a => {
    const cells = rows.map(b => ({ rosterId: b.rosterId, ...recordWithSchedule(all, a.rosterId, b.rosterId) }));
    const sorted = [...cells].sort((x, y) => winPct(y) - winPct(x));
    return { rosterId: a.rosterId, cells, best: sorted[0]!, worst: sorted.at(-1)! };
  });
}

/** Record if the team had played every other team every week. */
export function allPlay(all: Game[], rosterId: number): Record3 {
  const rec = { w: 0, l: 0, t: 0 };
  for (const mine of all.filter(g => g.rosterId === rosterId)) {
    for (const other of all.filter(g => g.week === mine.week && g.rosterId !== rosterId)) {
      const r = result({ points: mine.points, opponentPoints: other.points });
      rec[r === 'W' ? 'w' : r === 'L' ? 'l' : 't']++;
    }
  }
  return rec;
}

export interface PowerRow {
  rank: number;
  rosterId: number;
  /** 0 to 100. */
  score: number;
  allPlay: Record3;
  pf: number;
  /** Points over the last 3 weeks. */
  last3: number;
  /** Places gained since last week (negative = dropped). Null in week 1. */
  move: number | null;
}

const normalize = (x: number, xs: number[]) => {
  const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
  return hi === lo ? 1 : (x - lo) / (hi - lo);
};

function scoreWeeks(all: Game[], upToWeek: number): Omit<PowerRow, 'move'>[] {
  const played = all.filter(g => g.week <= upToWeek);
  const ids = [...new Set(played.map(g => g.rosterId))];
  const base = ids.map(id => {
    const mine = played.filter(g => g.rosterId === id);
    return {
      rosterId: id,
      allPlay: allPlay(played, id),
      pf: round2(mine.reduce((s, g) => s + g.points, 0)),
      last3: round2(mine.filter(g => g.week > upToWeek - 3).reduce((s, g) => s + g.points, 0)),
    };
  });
  const pfs = base.map(b => b.pf);
  const l3 = base.map(b => b.last3);
  return base
    .map(b => {
      const n = b.allPlay.w + b.allPlay.l + b.allPlay.t;
      const pct = n ? (b.allPlay.w + b.allPlay.t / 2) / n : 0;
      const score = 100 * (0.5 * pct + 0.3 * normalize(b.pf, pfs) + 0.2 * normalize(b.last3, l3));
      return { ...b, rank: 0, score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score || b.pf - a.pf)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 50% all play win %, 30% points for, 20% last 3 weeks' points (both scaled 0 to 1 across the league). */
export function powerRankings(all: Game[], upToWeek: number): PowerRow[] {
  const now = scoreWeeks(all, upToWeek);
  const before = upToWeek > 1 ? scoreWeeks(all, upToWeek - 1) : [];
  return now.map(r => {
    const prev = before.find(p => p.rosterId === r.rosterId);
    return { ...r, move: prev ? prev.rank - r.rank : null };
  });
}

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
export type Position = (typeof POSITIONS)[number];

/** Trimmed Sleeper players. The committed src/data/players.json holds only the site's subset (see siteSubset). */
/** body: injury body part (e.g. "Ankle"), only for injured players and only when Sleeper sends one. */
export type Players = Record<string, { name: string; pos: string; team: string | null; injury: string | null; body?: string }>;

const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/** Sleeper's /players/nfl map trimmed to what the site and reports use. */
export function trimPlayers(all: Record<string, Record<string, unknown>>): Players {
  const out: Players = {};
  for (const id of Object.keys(all).sort()) {
    const p = all[id] as { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string | null; injury_status?: string | null; injury_body_part?: string | null };
    if (!p.position || !FANTASY_POSITIONS.has(p.position)) continue;
    const injury = p.injury_status || null;
    out[id] = {
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos: p.position,
      team: p.team ?? null,
      injury,
      ...(injury && p.injury_body_part ? { body: p.injury_body_part } : {}),
    };
  }
  return out;
}

const INJURY: Record<string, { short: string; long: string; level: 'warn' | 'out' }> = {
  Probable: { short: 'P', long: 'Probable', level: 'warn' },
  Questionable: { short: 'Q', long: 'Questionable', level: 'warn' },
  Doubtful: { short: 'D', long: 'Doubtful', level: 'warn' },
  Out: { short: 'OUT', long: 'Out', level: 'out' },
  IR: { short: 'IR', long: 'Injured reserve', level: 'out' },
  PUP: { short: 'PUP', long: 'Physically unable to perform', level: 'out' },
  Sus: { short: 'SUS', long: 'Suspended', level: 'out' },
  DNR: { short: 'DNR', long: 'Did not report', level: 'warn' },
};

/** Tag for a Sleeper injury_status, or null when there is nothing to show. "NA" (not active) is deliberately skipped. */
export const injuryTag = (status: string | null | undefined) => (status ? INJURY[status] ?? null : null);

export interface PositionPoints {
  rosterId: number;
  points: Record<Position, number>;
}

/** Starter points per team by each player's real position (a FLEX WR counts as WR). */
export function positionPoints(weeks: Matchup[][], players: Players): PositionPoints[] {
  const byRoster = new Map<number, Record<Position, number>>();
  for (const m of weeks.flat()) {
    const pts = byRoster.get(m.roster_id) ?? { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    m.starters.forEach((id, i) => {
      const pos = players[id]?.pos as Position | undefined;
      if (pos && pos in pts) pts[pos] = round2(pts[pos] + (m.starters_points[i] ?? 0));
    });
    byRoster.set(m.roster_id, pts);
  }
  return [...byRoster].map(([rosterId, points]) => ({ rosterId, points }));
}

/** Pass `previous` (position points through last week) to get movement; otherwise move is null. */
export function positionRankings(
  all: PositionPoints[],
  pos: Position,
  previous?: PositionPoints[],
): { rank: number; rosterId: number; points: number; move: number | null }[] {
  const rank = (pp: PositionPoints[]) => {
    const sorted = pp.map(p => ({ rosterId: p.rosterId, points: p.points[pos] })).sort((a, b) => b.points - a.points);
    const ranks = rankBy(sorted.map(s => s.points));
    return sorted.map((s, i) => ({ ...s, rank: ranks[i]! }));
  };
  const before = previous ? rank(previous) : [];
  return rank(all).map(r => {
    const prev = before.find(p => p.rosterId === r.rosterId);
    return { ...r, move: prev ? prev.rank - r.rank : null };
  });
}

export interface Fact {
  kind: 'high' | 'unlucky' | 'blowout' | 'close' | 'streak';
  title: string;
  /** Plain sentence naming the team, the week, and the number. */
  text: string;
  rosterId: number;
  value: number;
  week?: number;
}

/** 3 to 5 standings facts. Facts that don't make sense yet (like a streak in week 1) are skipped. */
export function facts(rows: StandingsRow[], all: Game[]): Fact[] {
  const name = (id: number) => rows.find(r => r.rosterId === id)?.team ?? 'Unknown';
  const pts = (n: number) => n.toFixed(2);
  const out: Fact[] = [];
  if (!all.length) return out;

  const high = all.reduce((a, b) => (b.points > a.points ? b : a));
  out.push({ kind: 'high', title: 'Highest score', rosterId: high.rosterId, value: high.points, week: high.week,
    text: `${name(high.rosterId)} put up ${pts(high.points)} in week ${high.week}.` });

  const unlucky = rows.reduce((a, b) => (b.pa > a.pa ? b : a));
  out.push({ kind: 'unlucky', title: 'Toughest luck', rosterId: unlucky.rosterId, value: unlucky.pa,
    text: `${unlucky.team} has faced ${pts(unlucky.pa)} points, the most in the league.` });

  const wins = all.filter(g => g.points > g.opponentPoints);
  if (wins.length) {
    const margin = (g: Game) => round2(g.points - g.opponentPoints);
    const blowout = wins.reduce((a, b) => (margin(b) > margin(a) ? b : a));
    out.push({ kind: 'blowout', title: 'Biggest blowout', rosterId: blowout.rosterId, value: margin(blowout), week: blowout.week,
      text: `${name(blowout.rosterId)} beat ${name(blowout.opponentId)} by ${pts(margin(blowout))} in week ${blowout.week}.` });
    const close = wins.reduce((a, b) => (margin(b) < margin(a) ? b : a));
    out.push({ kind: 'close', title: 'Closest game', rosterId: close.rosterId, value: margin(close), week: close.week,
      text: `${name(close.rosterId)} edged ${name(close.opponentId)} by ${pts(margin(close))} in week ${close.week}.` });
  }

  const streaks = rows.filter(r => r.streak.endsWith('W')).map(r => ({ r, n: parseInt(r.streak, 10) }));
  const best = streaks.sort((a, b) => b.n - a.n || b.r.pf - a.r.pf)[0];
  if (best && best.n >= 2) {
    out.push({ kind: 'streak', title: 'Hottest team', rosterId: best.r.rosterId, value: best.n,
      text: `${best.r.team} has won ${best.n} straight.` });
  }
  return out;
}

/** Actual wins minus average wins across all schedules. Positive = lucky schedule. Luckiest first. */
export function scheduleLuck(matrix: WhatIfRow[]): { rosterId: number; actualWins: number; avgWins: number; luck: number }[] {
  return matrix
    .map((row, i) => {
      const avgWins = row.cells.reduce((s, c) => s + winPct(c), 0) / row.cells.length;
      const actualWins = winPct(row.cells[i]!);
      return { rosterId: row.rosterId, actualWins, avgWins, luck: actualWins - avgWins };
    })
    .sort((a, b) => b.luck - a.luck);
}

/** Player ids our pages use: current rosters, every week's players and starters, and this season's draft picks. */
export function siteIds(
  rosters: { roster_id: number; players?: string[] | null }[],
  weeks: Matchup[][],
  picks: { player_id: string }[],
): Set<string> {
  const ids = new Set([
    ...rosters.flatMap(r => r.players ?? []),
    ...weeks.flat().flatMap(m => [...(m.players ?? []), ...m.starters]),
    ...picks.map(p => p.player_id),
  ]);
  ids.delete('0'); // Sleeper's empty lineup slot
  return ids;
}

/** Only these players, sorted by id. Sleeper's full list stays out of the repo; the site needs just these. */
export function siteSubset(all: Players, ids: Iterable<string>): Players {
  return Object.fromEntries([...new Set(ids)].filter(id => all[id]).sort().map(id => [id, all[id]!]));
}
