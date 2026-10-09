// Trends page: real weekly points from our league (Sleeper), the other weeks filled from nflverse, plus FantasyCalc's
// 30 day momentum.
// Momentum is a percentage we compute in the daily job; FantasyCalc's values are never saved.
import type { FcValue } from './fantasycalc.ts';
import { fillWeeks, luck, type Luck, type NflPlayer } from './nflverse.ts';
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
  /** Last season's average per rostered week, null if he wasn't in this league. */
  avg25: number | null;
  /** Average points per week played this season, null before any. */
  avg26: number | null;
  /** Average of his most recent rostered weeks this season (see recentWeeks), null before 4 weeks. */
  recent: number | null;
  /** How many weeks `recent` covers: 2 until he has 6 weeks, then 3. */
  recentWeeks: number;
  /** This season's form: recent minus his average in the weeks before them. Positive = heating up. */
  form: number | null;
  /** avg26 minus avg25, null if either is missing. */
  diff: number | null;
  /** FantasyCalc 30 day momentum (0.12 = +12%), null if unknown. */
  momentum: number | null;
  /** Buy low or sell high from nflverse expected points, null if neither or no data. */
  luck: Luck | null;
}

/** Every rostered QB/RB/WR/TE, best 2026 average first. With nflverse data, this season's weeks before he was on a
 * roster here are filled in, so his line, average and form cover his whole season. */
export function trendRows(
  rosters: { roster_id: number; players?: string[] | null }[],
  players: Players,
  weeks26: Matchup[][],
  weeks25: Matchup[][],
  momentum: Record<string, number>,
  nfl: Record<string, NflPlayer> = {},
): TrendRow[] {
  return rosters
    .flatMap(r => r.players ?? [])
    .filter(id => SKILL.includes(players[id]?.pos ?? ''))
    .map(id => {
      const s25 = weeklyPoints(weeks25, id);
      const s26 = fillWeeks(weeklyPoints(weeks26, id), nfl[id]);
      const [a25, a26] = [mean(s25), mean(s26)];
      // Recent weeks vs the weeks BEFORE them, so one bad early week can't make a cooling player look hot.
      const played = s26.filter((x): x is number => x !== null);
      const recentWeeks = played.length >= 6 ? 3 : 2;
      const enough = played.length >= 4;
      const recent = enough ? mean(played.slice(-recentWeeks)) : null;
      const before = enough ? mean(played.slice(0, -recentWeeks)) : null;
      return {
        id, pos: players[id]!.pos, s25, s26, avg25: a25, avg26: a26, recent, recentWeeks,
        form: recent !== null && before !== null ? recent - before : null,
        diff: a25 !== null && a26 !== null ? a26 - a25 : null,
        momentum: momentum[id] ?? null,
        luck: luck(nfl[id]),
      };
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

/** Heating up THIS season: recent weeks most above the weeks before them, among regulars. */
export function heatingUp(rows: TrendRow[], n = 3): TrendRow[] {
  return rows.filter(r => r.form !== null && (r.avg26 ?? 0) >= REGULAR_AVG).sort((a, b) => b.form! - a.form!).slice(0, n);
}

/** Biggest 30 day market riser among regulars, or null before momentum exists. */
export function marketMover(rows: TrendRow[]): TrendRow | null {
  return rows.filter(r => r.momentum !== null && (r.avg26 ?? 0) >= REGULAR_AVG).sort((a, b) => b.momentum! - a.momentum!)[0] ?? null;
}
