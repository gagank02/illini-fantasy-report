// FantasyCalc trade values. Their terms: https://fantasycalc.com/api-docs
// - Only documented endpoints. We call GET /values/current and nothing else.
// - Their docs: cache the result and refresh it at most once per hour. We are stricter: only
//   scripts/update-values.ts calls the API, at most once per UTC day (even after a failed call), from the
//   daily refresh job. Builds, tests, CI, and previews read the saved file.
// - They ask for a human email before a public launch (see SPEC.md).
// - Show "FantasyCalc.com" with a link on every page that shows the data.
// - Non-commercial use only, and no material substitute for their content. Raw values never leave the
//   daily job: it computes trade suggestions and commits only those (src/data/trades.json).
import { existsSync, readFileSync } from 'node:fs';
import type { League } from './sleeper.ts';
import type { Players } from './stats.ts';
import { saveBoard, tradeBoard, valuedRosters, type SavedBoard, type TradeBoard } from './trades.ts';

const BASE = 'https://api.fantasycalc.com';
export const SAVED_PATH = 'src/data/trades.json';
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

/** Sleeper id → position and value. Lives only in memory in the daily job, never saved to the repo. */
export type Values = Record<string, { pos: string; value: number }>;

/** What src/data/trades.json holds: trade suggestions, no player values. */
export interface SavedTrades {
  /** UTC date of the fetch, e.g. "2026-10-08". */
  fetched: string;
  query: ValuesQuery;
  board: SavedBoard;
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
export function keepRostered(values: FcValue[], rostered: Set<string>, isDynasty: boolean): Values {
  const out: Values = {};
  for (const v of values) {
    const id = v.player.sleeperId;
    const value = isDynasty ? v.value : (v.redraftValue ?? v.value);
    if (id && rostered.has(id) && value > 0) out[id] = { pos: v.player.position, value };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Below this share of rostered QB/RB/WR/TE with a value, a fresh list is treated as broken and not saved. */
export const MIN_COVERAGE = 0.5;

/**
 * How well a fresh value list covers our rostered QB/RB/WR/TE (Sleeper is the source of truth for position).
 * Run before saving: if it isn't ok, the script throws and yesterday's file stays.
 */
export function checkCoverage(values: Values, rostered: string[], players: Players) {
  const skill = rostered.filter(id => ['QB', 'RB', 'WR', 'TE'].includes(players[id]?.pos ?? ''));
  const missing = skill.filter(id => !values[id]);
  const posMismatch = Object.entries(values)
    .filter(([id, v]) => players[id] && players[id].pos !== v.pos)
    .map(([id, v]) => `${players[id]!.name} (FantasyCalc ${v.pos}, Sleeper ${players[id]!.pos})`);
  const valued = skill.length - missing.length;
  return { skill: skill.length, valued, missing: missing.map(id => players[id]?.name ?? id), posMismatch, ok: skill.length > 0 && valued / skill.length >= MIN_COVERAGE };
}

type Env = Record<string, string | undefined>;

/**
 * Whether the update script may call FantasyCalc now: only when the daily job asks (FANTASYCALC=live),
 * never in tests, and not if today's values are already saved, so reruns add no calls.
 */
export function mayFetch(env: Env, saved: SavedTrades | null, today: string): boolean {
  if (env.FANTASYCALC !== 'live' || env.VITEST) return false;
  return saved?.fetched !== today;
}

export function readSaved(path = SAVED_PATH): SavedTrades | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SavedTrades) : null;
}

/** The saved file's text. One trade per line keeps daily diffs readable. */
export function serializeTrades(fetched: string, query: ValuesQuery, board: TradeBoard): string {
  const saved = saveBoard(board);
  const group = (g: Record<string, unknown[]>) =>
    `{\n${Object.entries(g).map(([k, ts]) => `    ${JSON.stringify(k)}: [${ts.map(t => `\n      ${JSON.stringify(t)}`).join(',')}${ts.length ? '\n    ' : ''}]`).join(',\n')}\n  }`;
  return `{\n  "fetched": ${JSON.stringify(fetched)},\n  "query": ${JSON.stringify(query)},\n  "board": {\n  "pairs": ${group(saved.pairs)},\n  "byTeam": ${group(saved.byTeam)}\n  }\n}\n`;
}

/** Made up values for local work and tests (tests/fixtures), keyed by Sleeper id. */
export function sampleValues(): Values {
  const all = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) as FcValue[];
  return keepRostered(all, new Set(all.flatMap(v => (v.player.sleeperId ? [v.player.sleeperId] : []))), false);
}

const useSample = (env: Env) => env.FANTASYCALC === 'sample' && env.CF_PAGES !== '1';

/** Whether the Trades tab should show: saved trades exist, or local sample mode. Cheap, for the nav. */
export function tradesAvailable(env: Env = process.env, path = SAVED_PATH): boolean {
  return useSample(env) || existsSync(path);
}

/**
 * Trades for this build, read from disk. Never fetches. null until the daily job has saved some.
 * FANTASYCALC=sample builds trades from made up values for local work; Cloudflare builds ignore it.
 */
export function loadTrades(
  env: Env = process.env,
  rosters: { roster_id: number; players?: string[] | null }[] = [],
  rosterPositions: string[] = [],
  path = SAVED_PATH,
): { sample: boolean; saved: SavedTrades } | null {
  if (useSample(env)) {
    const board = saveBoard(tradeBoard(valuedRosters(rosters, new Map(Object.entries(sampleValues()))), rosterPositions));
    return { sample: true, saved: { fetched: 'sample', query: { isDynasty: false, numQbs: '1', numTeams: 12, ppr: 1 }, board } };
  }
  const saved = readSaved(path);
  return saved ? { sample: false, saved } : null;
}
