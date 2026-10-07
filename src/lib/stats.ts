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
