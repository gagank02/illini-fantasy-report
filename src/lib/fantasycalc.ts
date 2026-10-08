// FantasyCalc trade values. Their terms: https://fantasycalc.com/api-docs
// - Only documented endpoints. We call GET /values/current and nothing else.
// - Their docs: cache the result and refresh it at most once per hour. We are stricter: only
//   scripts/update-values.ts calls the API, at most once per UTC day (even after a failed call), from the
//   daily refresh job. Builds, tests, CI, and previews read the saved file.
// - They ask for a human email before a public launch (see SPEC.md).
// - Show "FantasyCalc.com" with a link on every page that shows the data.
// - Non-commercial use only, and don't republish their full value list. The saved file keeps only
//   players on our league's rosters.
import { existsSync, readFileSync } from 'node:fs';
import type { League } from './sleeper.ts';

const BASE = 'https://api.fantasycalc.com';
export const SAVED_PATH = 'src/data/trade-values.json';
export const SAMPLE_PATH = 'tests/fixtures/fantasycalc-values.sample.json';

export interface FcValue {
  player: { id: number; name: string; position: string; maybeTeam?: string | null; sleeperId?: string | null };
  value: number;
  redraftValue: number;
}

export interface ValuesQuery {
  isDynasty: boolean;
  numQbs: '1' | '2';
  numTeams: 8 | 10 | 12 | 14;
  ppr: 0 | 0.5 | 1;
}

/** What src/data/trade-values.json holds. values: Sleeper id → position and value. */
export interface SavedValues {
  /** UTC date of the fetch, e.g. "2026-10-08". */
  fetched: string;
  query: ValuesQuery;
  values: Record<string, { pos: string; value: number }>;
}

const pick = <T extends number>(n: number, allowed: readonly T[]): T =>
  allowed.reduce((best, a) => (Math.abs(a - n) < Math.abs(best - n) ? a : best), allowed[0]!);

/** The FantasyCalc format closest to our Sleeper league settings. */
export function queryFor(league: League): ValuesQuery {
  const qbSlots = league.roster_positions.filter(p => p === 'QB' || p === 'SUPER_FLEX').length;
  return {
    isDynasty: league.settings.type === 2,
    numQbs: qbSlots > 1 ? '2' : '1',
    numTeams: pick(league.total_rosters, [8, 10, 12, 14] as const),
    ppr: pick(league.scoring_settings?.rec ?? 1, [0, 0.5, 1] as const),
  };
}

export function valuesUrl(q: ValuesQuery): string {
  const params = new URLSearchParams({ isDynasty: String(q.isDynasty), numQbs: q.numQbs, numTeams: String(q.numTeams), ppr: String(q.ppr) });
  return `${BASE}/values/current?${params}`;
}

/** Values for `rostered` players only, keyed by Sleeper id. Redraft leagues use redraftValue. */
export function keepRostered(values: FcValue[], rostered: Set<string>, isDynasty: boolean): SavedValues['values'] {
  const out: SavedValues['values'] = {};
  for (const v of values) {
    const id = v.player.sleeperId;
    const value = isDynasty ? v.value : (v.redraftValue ?? v.value);
    if (id && rostered.has(id) && value > 0) out[id] = { pos: v.player.position, value };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

type Env = Record<string, string | undefined>;

/**
 * Whether the update script may call FantasyCalc now: only when the daily job asks (FANTASYCALC=live),
 * never in tests, and not if today's values are already saved, so reruns add no calls.
 */
export function mayFetch(env: Env, saved: SavedValues | null, today: string): boolean {
  if (env.FANTASYCALC !== 'live' || env.VITEST) return false;
  return saved?.fetched !== today;
}

export function readSaved(path = SAVED_PATH): SavedValues | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SavedValues) : null;
}

/**
 * Values for this build, read from disk. Never fetches. null until the daily job has saved values.
 * FANTASYCALC=sample swaps in made up values for local work; Cloudflare builds ignore it.
 */
export function buildValues(env: Env = process.env): { sample: boolean; saved: SavedValues } | null {
  if (env.FANTASYCALC === 'sample' && env.CF_PAGES !== '1') {
    const all = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) as FcValue[];
    const ids = new Set(all.flatMap(v => (v.player.sleeperId ? [v.player.sleeperId] : [])));
    const query: ValuesQuery = { isDynasty: false, numQbs: '1', numTeams: 12, ppr: 1 };
    return { sample: true, saved: { fetched: 'sample', query, values: keepRostered(all, ids, false) } };
  }
  const saved = readSaved();
  return saved ? { sample: false, saved } : null;
}
