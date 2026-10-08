// Trade finder. Pure: rosters and player values in, suggested trades out. No fetching here.
// A trade is suggested when it makes both teams' lineups better and the values swapped are close.

/** Which positions can fill each Sleeper lineup slot. Slots not listed (K, DEF, BN, IDP) are ignored. */
const SLOT_POSITIONS: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

/** Bench players still count a little: depth covers injuries and bye weeks. */
export const BENCH_WEIGHT = 0.1;
/** Most a trade's two sides may differ in total value, as a share of the bigger side. */
export const MAX_VALUE_GAP = 0.15;
/** Only each team's most valuable players are tried, which keeps the search small. */
const TOP_PLAYERS = 12;
/** Most trades with one partner in a team's "any team" list. */
const PER_PARTNER = 2;

export interface ValuedPlayer {
  id: string;
  pos: string;
  value: number;
}

export interface TradeTeam {
  rosterId: number;
  players: ValuedPlayer[];
}

export interface Trade {
  a: number;
  b: number;
  /** Player ids team a receives (team b gives them up). */
  aGets: string[];
  bGets: string[];
  /** Change in lineup score as a share of the team's score before, e.g. 0.04 = 4% better. */
  aGain: number;
  bGain: number;
  /** Total value of the players each team receives. */
  aGetsValue: number;
  bGetsValue: number;
}

/** Lineup slots that values can fill, most restrictive first so flex spots are filled last. */
export function lineupSlots(rosterPositions: string[]): string[][] {
  return rosterPositions
    .filter(p => p in SLOT_POSITIONS)
    .map(p => SLOT_POSITIONS[p]!)
    .sort((x, y) => x.length - y.length);
}

/** Best possible starters' value plus a little for the bench. Greedy, which is exact for standard slots. */
export function teamScore(players: ValuedPlayer[], slots: string[][]): number {
  const left = [...players].sort((x, y) => y.value - x.value);
  let starters = 0;
  for (const slot of slots) {
    const i = left.findIndex(p => slot.includes(p.pos));
    if (i >= 0) starters += left.splice(i, 1)[0]!.value;
  }
  const bench = left.reduce((sum, p) => sum + p.value, 0);
  return starters + BENCH_WEIGHT * bench;
}

/** Every group of one or two players. */
function groups(players: ValuedPlayer[]): ValuedPlayer[][] {
  const out: ValuedPlayer[][] = [];
  players.forEach((p, i) => {
    out.push([p]);
    for (const q of players.slice(i + 1)) out.push([p, q]);
  });
  return out;
}

const total = (ps: ValuedPlayer[]) => ps.reduce((sum, p) => sum + p.value, 0);

/** Trades between two teams, best first: the one where the team that gains less still gains the most. */
export function tradesBetween(a: TradeTeam, b: TradeTeam, slots: string[][]): Trade[] {
  const top = (t: TradeTeam) => [...t.players].sort((x, y) => y.value - x.value).slice(0, TOP_PLAYERS);
  const aBefore = teamScore(a.players, slots);
  const bBefore = teamScore(b.players, slots);
  if (aBefore <= 0 || bBefore <= 0) return [];
  const out: Trade[] = [];
  for (const aGives of groups(top(a))) {
    for (const bGives of groups(top(b))) {
      const aGetsValue = total(bGives);
      const bGetsValue = total(aGives);
      if (Math.abs(aGetsValue - bGetsValue) > MAX_VALUE_GAP * Math.max(aGetsValue, bGetsValue)) continue;
      const aAfter = teamScore([...a.players.filter(p => !aGives.includes(p)), ...bGives], slots);
      const bAfter = teamScore([...b.players.filter(p => !bGives.includes(p)), ...aGives], slots);
      const aGain = aAfter / aBefore - 1;
      const bGain = bAfter / bBefore - 1;
      if (aGain <= 0 || bGain <= 0) continue;
      out.push({ a: a.rosterId, b: b.rosterId, aGets: bGives.map(p => p.id), bGets: aGives.map(p => p.id), aGain, bGain, aGetsValue, bGetsValue });
    }
  }
  return out.sort((x, y) => Math.min(y.aGain, y.bGain) - Math.min(x.aGain, x.bGain));
}

/** Keeps the best `n`, dropping any trade that is an earlier one plus extra players. */
export function topTrades(trades: Trade[], n: number): Trade[] {
  const kept: Trade[] = [];
  const ids = (t: Trade) => new Set([...t.aGets, ...t.bGets]);
  for (const t of trades) {
    if (kept.length >= n) break;
    const mine = ids(t);
    if (kept.some(k => [...ids(k)].every(id => mine.has(id)))) continue;
    kept.push(t);
  }
  return kept;
}

/** The same trade seen from team b's side. */
export function flip(t: Trade): Trade {
  return { a: t.b, b: t.a, aGets: t.bGets, bGets: t.aGets, aGain: t.bGain, bGain: t.aGain, aGetsValue: t.bGetsValue, bGetsValue: t.aGetsValue };
}

export interface TradeBoard {
  /** Key `${a}-${b}` with a < b. */
  pairs: Map<string, Trade[]>;
  /** Best trades for each team with anyone, from that team's side. */
  byTeam: Map<number, Trade[]>;
}

export function tradeBoard(teams: TradeTeam[], rosterPositions: string[], perPair = 5, perTeam = 8): TradeBoard {
  const slots = lineupSlots(rosterPositions);
  const pairs = new Map<string, Trade[]>();
  const all = new Map<number, Trade[]>(teams.map(t => [t.rosterId, []]));
  const sorted = [...teams].sort((x, y) => x.rosterId - y.rosterId);
  sorted.forEach((a, i) => {
    for (const b of sorted.slice(i + 1)) {
      const found = topTrades(tradesBetween(a, b, slots), perPair);
      pairs.set(`${a.rosterId}-${b.rosterId}`, found);
      // At most PER_PARTNER from each team, so "any team" isn't one partner over and over.
      const few = found.slice(0, PER_PARTNER);
      all.get(a.rosterId)!.push(...few);
      all.get(b.rosterId)!.push(...few.map(flip));
    }
  });
  const byTeam = new Map([...all].map(([id, ts]) => [id, ts.sort((x, y) => Math.min(y.aGain, y.bGain) - Math.min(x.aGain, x.bGain)).slice(0, perTeam)]));
  return { pairs, byTeam };
}

/** Each roster's players that have a value. */
export function valuedRosters(rosters: { roster_id: number; players?: string[] | null }[], values: Map<string, { pos: string; value: number }>): TradeTeam[] {
  return rosters.map(r => ({
    rosterId: r.roster_id,
    players: (r.players ?? []).flatMap(id => {
      const v = values.get(id);
      return v ? [{ id, ...v }] : [];
    }),
  }));
}

/** A trade as saved and shown: no player values, only how far apart the two sides were (0.1 = 10%). */
export type SavedTrade = Omit<Trade, 'aGetsValue' | 'bGetsValue'> & { valueGap: number };

/** JSON friendly board of saved trades. Keys: `${a}-${b}` pairs and roster ids. */
export interface SavedBoard {
  pairs: Record<string, SavedTrade[]>;
  byTeam: Record<string, SavedTrade[]>;
}

const save = ({ aGetsValue, bGetsValue, ...t }: Trade): SavedTrade => ({
  ...t,
  valueGap: Math.round((Math.abs(aGetsValue - bGetsValue) / Math.max(aGetsValue, bGetsValue, 1)) * 1000) / 1000,
});

/** Drops the player values so the saved file holds nothing of FantasyCalc's but the suggestions. */
export function saveBoard(board: TradeBoard): SavedBoard {
  return {
    pairs: Object.fromEntries([...board.pairs].map(([k, ts]) => [k, ts.map(save)])),
    byTeam: Object.fromEntries([...board.byTeam].map(([k, ts]) => [String(k), ts.map(save)])),
  };
}

/** Trades are saved once a day; drop one whose players have since moved (a's gets must still be on b, and so on). */
export function stillValid(t: SavedTrade, rosters: { roster_id: number; players?: string[] | null }[]): boolean {
  const on = (rosterId: number, ids: string[]) => {
    const players = rosters.find(r => r.roster_id === rosterId)?.players ?? [];
    return ids.every(id => players.includes(id));
  };
  return on(t.b, t.aGets) && on(t.a, t.bGets);
}
