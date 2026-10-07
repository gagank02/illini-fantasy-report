// FantasyCalc trade values. Their terms: https://fantasycalc.com/api-docs
// - Only documented endpoints. We call GET /values/current and nothing else.
// - Cache it and refresh at most once an hour. We fetch once per build, and builds run about daily.
// - Show "FantasyCalc.com" with a link on every page that shows the data.
// - Non-commercial use only, and don't republish their full value list.
//
// Tests, CI, and preview builds must never call the API. Fetching is off unless
// FANTASYCALC=live is set, which only the Cloudflare Pages production environment has.
import { readFileSync } from 'node:fs';
import type { League } from './sleeper.ts';

const BASE = 'https://api.fantasycalc.com';
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

/** off: no values, the trades page says so. sample: made up values for local work. live: the real API. */
export type ValuesMode = 'off' | 'sample' | 'live';

type Env = Record<string, string | undefined>;

export function valuesMode(env: Env = process.env): ValuesMode {
  const want = env.FANTASYCALC;
  // Cloudflare sets CF_PAGES on every build and CF_PAGES_BRANCH to the branch being built.
  const onCloudflare = env.CF_PAGES === '1';
  if (want === 'live') {
    if (env.GITHUB_ACTIONS === 'true' || env.VITEST) return 'off';
    if (onCloudflare && env.CF_PAGES_BRANCH !== 'main') return 'off';
    return 'live';
  }
  // Sample values are fake, so they never go out in a Cloudflare build.
  if (want === 'sample' && !onCloudflare) return 'sample';
  return 'off';
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

let cached: Promise<FcValue[] | null> | undefined;

/** Values for this build, fetched at most once. null when values are off. */
export function loadValues(league: League, env: Env = process.env): Promise<FcValue[] | null> {
  cached ??= (async () => {
    const mode = valuesMode(env);
    if (mode === 'off') return null;
    if (mode === 'sample') return JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) as FcValue[];
    // If FantasyCalc is down, the trades page says it's off instead of failing the whole deploy.
    try {
      const res = await fetch(valuesUrl(queryFor(league)));
      if (!res.ok) throw new Error(`returned ${res.status}`);
      return (await res.json()) as FcValue[];
    } catch (e) {
      console.warn(`FantasyCalc /values/current failed, trades page is off this build: ${e}`);
      return null;
    }
  })();
  return cached;
}

/** Sleeper id → position and value. Redraft leagues use redraftValue. Kickers and defenses have no value. */
export function valueMap(values: FcValue[], isDynasty: boolean): Map<string, { pos: string; value: number }> {
  const out = new Map<string, { pos: string; value: number }>();
  for (const v of values) {
    const value = isDynasty ? v.value : (v.redraftValue ?? v.value);
    if (v.player.sleeperId && value > 0) out.set(v.player.sleeperId, { pos: v.player.position, value });
  }
  return out;
}
