// Sleeper public API. Read only, no key. Called at build time only.
const BASE = 'https://api.sleeper.app/v1';

export interface League {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  previous_league_id: string | null;
  draft_id: string;
  status: string;
  roster_positions: string[];
  settings: { playoff_week_start: number; playoff_teams: number; last_scored_leg?: number };
}

export interface User {
  user_id: string;
  display_name: string;
  metadata: { team_name?: string | null };
}

export interface Roster {
  roster_id: number;
  owner_id: string;
  settings: {
    wins: number; losses: number; ties: number;
    fpts: number; fpts_decimal: number; fpts_against: number; fpts_against_decimal: number;
  };
  metadata: { record?: string; streak?: string };
  /** Current roster player ids (as of the fetch, not any past week). */
  players?: string[];
}

export interface Matchup {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  starters: string[];
  starters_points: number[];
  /** Every rostered player, bench included. */
  players?: string[];
  players_points?: Record<string, number>;
}

export interface Transaction {
  type: 'waiver' | 'free_agent' | 'trade' | string;
  status: 'complete' | 'failed' | string;
  /** player id → roster id that received / gave up the player */
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  roster_ids: number[];
  leg: number;
}

export interface Season {
  league: League;
  users: User[];
  rosters: Roster[];
  /** weeks[i] holds week i + 1, regular season weeks that are final only. */
  weeks: Matchup[][];
}

/** Sliding window rate limiter: resolves once a call fits within `max` per `windowMs`. */
export function createLimiter(max: number, windowMs: number): () => Promise<void> {
  const calls: number[] = [];
  return async function wait() {
    for (;;) {
      const now = Date.now();
      while (calls.length && now - calls[0]! >= windowMs) calls.shift();
      if (calls.length < max) { calls.push(now); return; }
      await new Promise(r => setTimeout(r, windowMs - (now - calls[0]!)));
    }
  };
}

// Sleeper may IP block above 1000 calls/min. Normal builds use ~100, so this only bites on a bug.
const limit = createLimiter(600, 60_000);

// One fetch per URL per build, shared by every page.
const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = limit().then(() => fetch(BASE + path)).then(res => {
      if (!res.ok) throw new Error(`Sleeper ${path} returned ${res.status}`);
      return res.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p as Promise<T>;
}

export function currentLeagueId(): string {
  const id = import.meta.env?.SLEEPER_LEAGUE_ID ?? process.env.SLEEPER_LEAGUE_ID;
  if (!id) throw new Error('SLEEPER_LEAGUE_ID is not set. Add it to .env (see .env.example), then restart npm run dev.');
  return id;
}

/** Weeks that count toward the regular season: final weeks before the playoffs. */
export function regularSeasonWeeks(league: League): number {
  return Math.min(league.settings.last_scored_leg ?? 0, league.settings.playoff_week_start - 1);
}

export function leagueById(leagueId: string): Promise<League> {
  return get<League>(`/league/${leagueId}`);
}

/** Playoff bracket. The match with p === 1 is the final: w = champion roster, l = runner up. */
export function winnersBracket(leagueId: string): Promise<{ r: number; m: number; t1: number | null; t2: number | null; w: number | null; l: number | null; p?: number }[]> {
  return get(`/league/${leagueId}/winners_bracket`);
}

/** Every pick in a draft, with the player's name, position, and NFL team at draft time. */
export function draftPicks(draftId: string): Promise<import('./history.ts').DraftPick[]> {
  return get(`/draft/${draftId}/picks`);
}

export function weekMatchups(week: number, leagueId = currentLeagueId()): Promise<Matchup[]> {
  return get<Matchup[]>(`/league/${leagueId}/matchups/${week}`);
}

export function weekTransactions(week: number, leagueId = currentLeagueId()): Promise<Transaction[]> {
  return get<Transaction[]>(`/league/${leagueId}/transactions/${week}`);
}

/** Sleeper wide adds or drops over the last 24 hours. */
export function trending(kind: 'add' | 'drop'): Promise<{ player_id: string; count: number }[]> {
  return get(`/players/nfl/trending/${kind}?lookback_hours=24&limit=10`);
}

export function leagueUsers(leagueId = currentLeagueId()): Promise<User[]> {
  return get<User[]>(`/league/${leagueId}/users`);
}

export async function loadSeason(leagueId = currentLeagueId()): Promise<Season> {
  const [league, users, rosters] = await Promise.all([
    get<League>(`/league/${leagueId}`),
    get<User[]>(`/league/${leagueId}/users`),
    get<Roster[]>(`/league/${leagueId}/rosters`),
  ]);
  const n = regularSeasonWeeks(league);
  const weeks = await Promise.all(Array.from({ length: n }, (_, i) => get<Matchup[]>(`/league/${leagueId}/matchups/${i + 1}`)));
  return { league, users, rosters, weeks };
}
