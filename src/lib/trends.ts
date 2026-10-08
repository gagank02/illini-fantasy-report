// Trends page: real weekly points from our league (Sleeper) plus FantasyCalc's 30 day momentum.
// Momentum is a percentage we compute in the daily job; FantasyCalc's values are never saved.
import type { FcValue } from './fantasycalc.ts';
import type { Matchup } from './sleeper.ts';
import type { Players } from './stats.ts';

export const MOMENTUM_PATH = 'src/data/momentum.json';
const SKILL = ['QB', 'RB', 'WR', 'TE'];

/** A player's points each week, or null for weeks he wasn't on a roster in this league. */
export function weeklyPoints(weeks: Matchup[][], id: string): (number | null)[] {
  return weeks.map(wk => {
    const m = wk.find(x => x.players_points?.[id] !== undefined);
    return m ? m.players_points![id]! : null;
  });
}

/** 30 day value change as a share of the value 30 days ago: trend30Day / (value - trend30Day). */
export function momentumPct(v: Pick<FcValue, 'value'> & { trend30Day?: number }): number | null {
  if (typeof v.trend30Day !== 'number' || !Number.isFinite(v.trend30Day)) return null;
  const before = v.value - v.trend30Day;
  return before > 0 ? Math.round((v.trend30Day / before) * 1000) / 1000 : null;
}

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export interface TrendRow {
  id: string;
  pos: string;
  s25: (number | null)[];
  s26: (number | null)[];
  /** Average points per rostered week this season, null before any. */
  avg26: number | null;
  /** avg26 minus last season's average, null if he wasn't in this league last season. */
  diff: number | null;
  /** FantasyCalc 30 day momentum (0.12 = +12%), null if unknown. */
  momentum: number | null;
}

/** Every rostered QB/RB/WR/TE, best 2026 average first. */
export function trendRows(
  rosters: { roster_id: number; players?: string[] | null }[],
  players: Players,
  weeks26: Matchup[][],
  weeks25: Matchup[][],
  momentum: Record<string, number>,
): TrendRow[] {
  return rosters
    .flatMap(r => r.players ?? [])
    .filter(id => SKILL.includes(players[id]?.pos ?? ''))
    .map(id => {
      const s25 = weeklyPoints(weeks25, id);
      const s26 = weeklyPoints(weeks26, id);
      const [a25, a26] = [mean(s25), mean(s26)];
      return { id, pos: players[id]!.pos, s25, s26, avg26: a26, diff: a25 !== null && a26 !== null ? a26 - a25 : null, momentum: momentum[id] ?? null };
    })
    .sort((a, b) => (b.avg26 ?? -1) - (a.avg26 ?? -1));
}

/** SVG sparkline geometry. zero: include and mark a 0 baseline (for % series). null breaks the line. */
export function sparkline(series: (number | null)[], w: number, h: number, { pad = 4, zero = false } = {}) {
  const vals = series.filter((x): x is number => x !== null);
  const lo = zero ? Math.min(0, ...vals) : 0;
  const hi = Math.max(zero ? 0 : 1, ...vals);
  const x = (i: number) => (series.length === 1 ? w - pad : pad + (i * (w - 2 * pad)) / (series.length - 1));
  const y = (v: number) => pad + (h - 2 * pad) * (1 - (v - lo) / (hi - lo || 1));
  let d = '';
  let pen = false;
  series.forEach((v, i) => {
    if (v === null) return void (pen = false);
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  const lastV = series.at(-1);
  return { d: d.trim(), zeroY: zero ? y(0) : null, last: lastV != null ? { x: x(series.length - 1), y: y(lastV) } : null, x };
}

/** The committed file: percentages only. */
export function serializeMomentum(fetched: string, momentum: Record<string, number>): string {
  const sorted = Object.fromEntries(Object.entries(momentum).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ fetched, momentum: sorted }, null, 1)}\n`;
}

/** Made up momentum for local previews (FANTASYCALC=sample), stable per player. */
export function sampleMomentum(ids: string[]): Record<string, number> {
  return Object.fromEntries(ids.map(id => {
    let h = 2166136261;
    for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return [id, Math.round((((h >>> 0) % 601) / 1000 - 0.3) * 1000) / 1000];
  }));
}

/** Players averaging at least this many points count as regulars for home page picks (keeps deep bench noise out). */
export const REGULAR_AVG = 8;

/** Biggest scoring gains vs last season among regulars, for the home page. */
export function heatingUp(rows: TrendRow[], n = 3): TrendRow[] {
  // At least half of each season's weeks on a roster here, so a few backup games don't make a "trend".
  const enough = (xs: (number | null)[]) => xs.length > 0 && xs.filter(x => x !== null).length * 2 >= xs.length;
  return rows
    .filter(r => r.diff !== null && (r.avg26 ?? 0) >= REGULAR_AVG && enough(r.s25) && enough(r.s26))
    .sort((a, b) => b.diff! - a.diff!)
    .slice(0, n);
}

/** Biggest 30 day market riser among regulars, or null before momentum exists. */
export function marketMover(rows: TrendRow[]): TrendRow | null {
  return rows.filter(r => r.momentum !== null && (r.avg26 ?? 0) >= REGULAR_AVG).sort((a, b) => b.momentum! - a.momentum!)[0] ?? null;
}
