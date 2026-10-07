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
        record,
        streak: streak(record),
      };
    })
    .sort((a, b) => b.w + b.t / 2 - (a.w + a.t / 2) || b.pf - a.pf)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
