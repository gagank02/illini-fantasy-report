// nflverse: every NFL player's weekly PPR points, plus expected points from ffopportunity (ffverse).
// Same pattern as Sleeper's player list and FantasyCalc: only the daily refresh job downloads the files
// (scripts/update-nflverse.ts). The full summary stays in git ignored .cache/nflverse-full.json, kept in the
// workflow's private Actions cache, never committed. The repo gets only what our pages show, in
// src/data/nflverse.json: the weeks that fill gaps in rostered players' lines, and the Buy low / Sell high tags.
// Builds and tests read that file and never fetch. The data is CC-BY 4.0: pages that show it credit and link nflverse.
import { existsSync, readFileSync } from 'node:fs';

export const NFLVERSE_PATH = 'src/data/nflverse.json';
export const NFL_FULL_PATH = '.cache/nflverse-full.json';
const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';

/** The three files the daily job downloads. Plain CSV from GitHub releases, a few MB in all. */
export function nflverseUrls(season: number) {
  return {
    ids: `${RELEASES}/weekly_rosters/roster_weekly_${season}.csv`,
    stats: `${RELEASES}/stats_player/stats_player_week_${season}.csv`,
    expected: `https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_${season}.csv`,
    snaps: `${RELEASES}/snap_counts/snap_counts_${season}.csv`,
    games: `${RELEASES}/schedules/games.csv`,
  };
}

/** Rows as objects keyed by the header line. Handles quoted fields with commas, quotes and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field || row.length) endRow();
  const [head, ...body] = rows;
  return (body ?? []).filter(r => r.length > 1).map(r => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

export interface NflPlayer {
  /** PPR points by week (index 0 = week 1), null for weeks without a game (byes, missed games). */
  pts: (number | null)[];
  /** Games with expected points, and average actual and expected PPR points per game from ffopportunity. */
  games: number;
  act: number;
  exp: number;
  /** For the player panel, by week like pts: offensive snap %, targets, carries, catches, pass attempts, expected points. */
  snap?: (number | null)[];
  tgt?: (number | null)[];
  car?: (number | null)[];
  rec?: (number | null)[];
  att?: (number | null)[];
  expW?: (number | null)[];
  /** Season totals. */
  tot?: Totals;
  bio?: { birth: string | null; exp: number | null; college: string | null; pick: number | null; year: number | null };
}

export interface Totals {
  tgt: number; rec: number; recYd: number; recTd: number;
  car: number; rushYd: number; rushTd: number;
  att: number; cmp: number; passYd: number; passTd: number; int: number;
}

/** One regular season game: week, away team, home team (Sleeper abbreviations). */
export type Game = [number, string, string];

export interface NflData {
  /** UTC date the files were downloaded. */
  fetched: string;
  season: number;
  players: Record<string, NflPlayer>;
  games?: Game[];
}

/** nflverse calls the Rams LA; Sleeper calls them LAR. Everything else matches. */
export const sleeperTeam = (t: string) => (t === 'LA' ? 'LAR' : t);

const REG_WEEKS = 18;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Joins the three files on gsis id, for every player with a Sleeper id. Regular season only. */
export function buildNflData(
  fetched: string,
  season: number,
  files: {
    ids: Record<string, string>[];
    stats: Record<string, string>[];
    expected: Record<string, string>[];
    snaps?: Record<string, string>[];
    games?: Record<string, string>[];
  },
): NflData {
  const gsisToSleeper = new Map<string, string>();
  const pfrToSleeper = new Map<string, string>();
  const bios = new Map<string, NonNullable<NflPlayer['bio']>>();
  const num = (x: string | undefined) => (x ? Number(x) : null);
  for (const r of files.ids) {
    if (!r.sleeper_id || !r.gsis_id) continue;
    gsisToSleeper.set(r.gsis_id, r.sleeper_id);
    if (r.pfr_id) pfrToSleeper.set(r.pfr_id, r.sleeper_id);
    bios.set(r.sleeper_id, { birth: r.birth_date || null, exp: num(r.years_exp), college: r.college || null, pick: num(r.draft_number), year: num(r.entry_year) });
  }

  const players: Record<string, NflPlayer> = {};
  const get = (gsis: string | undefined) => {
    const id = gsisToSleeper.get(gsis ?? '');
    return id ? (players[id] ??= { pts: [], games: 0, act: 0, exp: 0 }) : null;
  };
  for (const r of files.stats) {
    const p = get(r.player_id);
    const w = Number(r.week);
    if (!p || r.season_type !== 'REG' || !(w >= 1 && w <= REG_WEEKS)) continue;
    p.pts[w - 1] = round1(Number(r.fantasy_points_ppr) || 0);
    const n = (k: string) => Number(r[k]) || 0;
    for (const [k, col] of [['tgt', 'targets'], ['car', 'carries'], ['rec', 'receptions'], ['att', 'attempts']] as const) (p[k] ??= [])[w - 1] = n(col);
    const t = (p.tot ??= { tgt: 0, rec: 0, recYd: 0, recTd: 0, car: 0, rushYd: 0, rushTd: 0, att: 0, cmp: 0, passYd: 0, passTd: 0, int: 0 });
    t.tgt += n('targets'); t.rec += n('receptions'); t.recYd += n('receiving_yards'); t.recTd += n('receiving_tds');
    t.car += n('carries'); t.rushYd += n('rushing_yards'); t.rushTd += n('rushing_tds');
    t.att += n('attempts'); t.cmp += n('completions'); t.passYd += n('passing_yards'); t.passTd += n('passing_tds'); t.int += n('passing_interceptions');
  }
  for (const r of files.snaps ?? []) {
    const id = pfrToSleeper.get(r.pfr_player_id ?? '');
    const p = id ? players[id] : undefined;
    const w = Number(r.week);
    if (!p || r.game_type !== 'REG' || !(w >= 1 && w <= REG_WEEKS)) continue;
    (p.snap ??= [])[w - 1] = Math.round((Number(r.offense_pct) || 0) * 100);
  }
  for (const r of files.expected) {
    const p = get(r.player_id);
    const w = Number(r.week);
    if (!p || !(w >= 1 && w <= REG_WEEKS) || r.total_fantasy_points_exp === '') continue;
    p.games++;
    (p.expW ??= [])[w - 1] = round1(Number(r.total_fantasy_points_exp) || 0);
    p.act += Number(r.total_fantasy_points) || 0;
    p.exp += Number(r.total_fantasy_points_exp) || 0;
  }
  const dense = (xs: (number | null)[] | undefined) => (xs ? Array.from(xs, x => x ?? null) : undefined);
  for (const [id, p] of Object.entries(players)) {
    p.pts = dense(p.pts)!;
    for (const k of ['snap', 'tgt', 'car', 'rec', 'att', 'expW'] as const) if (p[k]) p[k] = dense(p[k]);
    p.act = p.games ? round1(p.act / p.games) : 0;
    p.exp = p.games ? round1(p.exp / p.games) : 0;
    if (bios.has(id)) p.bio = bios.get(id);
  }
  const games = (files.games ?? [])
    .filter(r => Number(r.season) === season && r.game_type === 'REG')
    .map((r): Game => [Number(r.week), sleeperTeam(r.away_team!), sleeperTeam(r.home_team!)]);
  return { fetched, season, players, ...(files.games ? { games } : {}) };
}

/** The full summary for the Actions cache (never committed), or null if missing or not from this season. */
export function readFull(season: number, path = NFL_FULL_PATH): NflData | null {
  if (!existsSync(path)) return null;
  const d = JSON.parse(readFileSync(path, 'utf8')) as NflData;
  return d.season === season ? d : null;
}

/** What the committed file holds: only numbers our pages show. */
export interface SiteNfl {
  fetched: string;
  season: number;
  /** Per rostered player, the weeks his line is missing in our league (null elsewhere). Only players with a fill. */
  fill: Record<string, (number | null)[]>;
  /** Only tagged rostered players. */
  tags: Record<string, Luck>;
  /** The Trends player panel, per rostered player with nflverse games. */
  cards?: Record<string, Card>;
  /** Bye week and next games for the NFL teams of rostered players (Sleeper abbreviations). */
  teams?: Record<string, TeamSchedule>;
}

export interface Card {
  /** By week, up to the weeks our league has scored: offensive snap %, the usage stat for his position, expected points. */
  snap: (number | null)[];
  use: (number | null)[];
  exp: (number | null)[];
  /** Season totals that matter for his position. */
  tot: Partial<Totals>;
  /** Age on the day the data was fetched, NFL seasons, overall draft pick (null if undrafted) and draft year. */
  bio: { age: number | null; exp: number | null; college: string | null; pick: number | null; year: number | null };
}

export interface TeamSchedule {
  bye: number | null;
  /** The next three games after the weeks our league has scored: week, opponent, and whether it's away. */
  next: { w: number; opp: string; away: boolean }[];
}

/** What the panel's usage line counts, by position. */
export const USE_LABEL: Record<string, string> = { QB: 'Pass attempts', RB: 'Touches', WR: 'Targets', TE: 'Targets' };

const TOTALS: Record<string, (keyof Totals)[]> = {
  QB: ['cmp', 'att', 'passYd', 'passTd', 'int', 'car', 'rushYd', 'rushTd'],
  RB: ['car', 'rushYd', 'rushTd', 'tgt', 'rec', 'recYd', 'recTd'],
  WR: ['tgt', 'rec', 'recYd', 'recTd'],
  TE: ['tgt', 'rec', 'recYd', 'recTd'],
};

const ageOn = (birth: string, day: string) => {
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

function card(p: NflPlayer, pos: string, weeks: number, fetched: string): Card {
  const cut = (xs: (number | null)[] | undefined) => Array.from({ length: weeks }, (_, i) => xs?.[i] ?? null);
  const use = pos === 'QB' ? cut(p.att)
    : pos === 'RB' ? cut(p.car).map((c, i) => (c === null && p.rec?.[i] == null ? null : (c ?? 0) + (p.rec?.[i] ?? 0)))
    : cut(p.tgt);
  // Weeks he didn't play stay null (gaps), not zeros.
  const played = (xs: (number | null)[]) => xs.map((x, i) => (p.pts[i] == null ? null : x));
  const b = p.bio;
  return {
    snap: played(cut(p.snap)),
    use: played(use),
    exp: played(cut(p.expW)),
    tot: Object.fromEntries((TOTALS[pos] ?? []).map(k => [k, p.tot?.[k] ?? 0])),
    bio: { age: b?.birth ? ageOn(b.birth, fetched) : null, exp: b?.exp ?? null, college: b?.college ?? null, pick: b?.pick ?? null, year: b?.year ?? null },
  };
}

/** Bye week and the next three games after `weeks` for one team. */
export function teamSchedule(games: Game[], team: string, weeks: number): TeamSchedule {
  const mine = games.filter(([, away, home]) => away === team || home === team).sort((x, y) => x[0] - y[0]);
  if (!mine.length) return { bye: null, next: [] };
  const played = new Set(mine.map(g => g[0]));
  const last = Math.max(...played);
  const bye = Array.from({ length: last }, (_, i) => i + 1).find(w => !played.has(w)) ?? null;
  const next = mine.filter(g => g[0] > weeks).slice(0, 3).map(([w, away, home]) => ({ w, opp: away === team ? home : away, away: away === team }));
  return { bye, next };
}

/**
 * The site's subset: for each rostered QB/RB/WR/TE, nflverse points only for weeks our league has none
 * (up to the weeks our league has scored), and a tag only when he gets one. With `info`, also the Trends panel
 * card for each player and the schedule for each of their NFL teams.
 */
export function siteNfl(
  full: NflData,
  rostered: string[],
  leaguePoints: (id: string) => (number | null)[],
  info?: (id: string) => { pos: string; team: string | null },
): SiteNfl {
  const fill: SiteNfl['fill'] = {};
  const tags: SiteNfl['tags'] = {};
  const cards: NonNullable<SiteNfl['cards']> = {};
  const teams: NonNullable<SiteNfl['teams']> = {};
  for (const id of [...new Set(rostered)].sort((a, b) => a.localeCompare(b))) {
    const p = full.players[id];
    if (!p) continue;
    const league = leaguePoints(id);
    const gaps = league.map((v, i) => (v === null ? p.pts[i] ?? null : null));
    if (gaps.some(v => v !== null)) fill[id] = gaps;
    const tag = luck(p);
    if (tag) tags[id] = tag;
    if (!info) continue;
    const { pos, team } = info(id);
    cards[id] = card(p, pos, league.length, full.fetched);
    if (team && full.games && !teams[team]) teams[team] = teamSchedule(full.games, team, league.length);
  }
  const sortedTeams = Object.fromEntries(Object.entries(teams).sort(([a], [b]) => a.localeCompare(b)));
  return { fetched: full.fetched, season: full.season, fill, tags, ...(info ? { cards, teams: sortedTeams } : {}) };
}

/** The committed file. One player (or team) per line keeps daily diffs readable. */
export function serializeSiteNfl(d: SiteNfl): string {
  const group = (g: Record<string, unknown>) => Object.entries(g).map(([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(',\n');
  const extra = d.cards ? `,\n "cards": {\n${group(d.cards)}\n },\n "teams": {\n${group(d.teams ?? {})}\n }` : '';
  return `{\n "fetched": ${JSON.stringify(d.fetched)},\n "season": ${d.season},\n "fill": {\n${group(d.fill)}\n },\n "tags": {\n${group(d.tags)}\n }${extra}\n}\n`;
}

/** This build's nflverse data, read from disk. Never fetches. null until the daily job saves it, or if it's last season's. */
export function loadNflverse(season: number, path = NFLVERSE_PATH): SiteNfl | null {
  if (!existsSync(path)) return null;
  const d = JSON.parse(readFileSync(path, 'utf8')) as SiteNfl;
  return d.season === season ? d : null;
}

/** Our league's weekly points with the gaps (weeks not on a roster here) filled from nflverse. Same scoring: PPR. */
export function fillWeeks(league: (number | null)[], fill: (number | null)[] | undefined): (number | null)[] {
  return league.map((v, i) => v ?? fill?.[i] ?? null);
}

/** How far actual points per game must be from expected before a player is tagged. */
export const LUCK_GAP = 5;
/** Fewer games than this is too noisy to call. */
export const LUCK_GAMES = 3;
/** Only players who matter: the tagged side (expected for buy low, actual for sell high) must be at least this. */
export const LUCK_FLOOR = 8;

export interface Luck {
  kind: 'buy' | 'sell';
  act: number;
  exp: number;
  games: number;
}

/** Buy low: scoring well under what his targets and carries usually produce. Sell high: well over. */
export function luck(p: NflPlayer | undefined): Luck | null {
  if (!p || p.games < LUCK_GAMES) return null;
  const { act, exp, games } = p;
  if (act - exp <= -LUCK_GAP && exp >= LUCK_FLOOR) return { kind: 'buy', act, exp, games };
  if (act - exp >= LUCK_GAP && act >= LUCK_FLOOR) return { kind: 'sell', act, exp, games };
  return null;
}
