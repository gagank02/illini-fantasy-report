// nflverse: every NFL player's weekly PPR points, plus expected points from ffopportunity (ffverse).
// Only the daily refresh job downloads the files (scripts/update-nflverse.ts) and commits a small summary for
// rostered players to src/data/nflverse.json. Builds and tests read that file and never fetch.
// The data is CC-BY 4.0: pages that show it credit and link nflverse.
import { existsSync, readFileSync } from 'node:fs';

export const NFLVERSE_PATH = 'src/data/nflverse.json';
const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';

/** The three files the daily job downloads. Plain CSV from GitHub releases, a few MB in all. */
export function nflverseUrls(season: number) {
  return {
    ids: `${RELEASES}/weekly_rosters/roster_weekly_${season}.csv`,
    stats: `${RELEASES}/stats_player/stats_player_week_${season}.csv`,
    expected: `https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_${season}.csv`,
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
}

export interface NflData {
  /** UTC date the files were downloaded. */
  fetched: string;
  season: number;
  players: Record<string, NflPlayer>;
}

const REG_WEEKS = 18;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Joins the three files on gsis id and keeps only the given Sleeper ids. Regular season only. */
export function buildNflData(
  fetched: string,
  season: number,
  sleeperIds: string[],
  files: { ids: Record<string, string>[]; stats: Record<string, string>[]; expected: Record<string, string>[] },
): NflData {
  const want = new Set(sleeperIds);
  const gsisToSleeper = new Map<string, string>();
  for (const r of files.ids) if (want.has(r.sleeper_id!) && r.gsis_id) gsisToSleeper.set(r.gsis_id, r.sleeper_id!);

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
  }
  for (const r of files.expected) {
    const p = get(r.player_id);
    const w = Number(r.week);
    if (!p || !(w >= 1 && w <= REG_WEEKS) || r.total_fantasy_points_exp === '') continue;
    p.games++;
    p.act += Number(r.total_fantasy_points) || 0;
    p.exp += Number(r.total_fantasy_points_exp) || 0;
  }
  for (const p of Object.values(players)) {
    p.pts = Array.from(p.pts, x => x ?? null);
    p.act = p.games ? round1(p.act / p.games) : 0;
    p.exp = p.games ? round1(p.exp / p.games) : 0;
  }
  return { fetched, season, players };
}

/** The committed file. One player per line keeps daily diffs readable. */
export function serializeNflData(d: NflData): string {
  const lines = Object.keys(d.players).sort((a, b) => a.localeCompare(b)).map(id => `  ${JSON.stringify(id)}: ${JSON.stringify(d.players[id])}`);
  return `{\n "fetched": ${JSON.stringify(d.fetched)},\n "season": ${d.season},\n "players": {\n${lines.join(',\n')}\n }\n}\n`;
}

/** This build's nflverse data, read from disk. Never fetches. null until the daily job saves it, or if it's last season's. */
export function loadNflverse(season: number, path = NFLVERSE_PATH): NflData | null {
  if (!existsSync(path)) return null;
  const d = JSON.parse(readFileSync(path, 'utf8')) as NflData;
  return d.season === season ? d : null;
}

/** Our league's weekly points with the other weeks (not on a roster here) filled from nflverse. Same scoring: PPR. */
export function fillWeeks(league: (number | null)[], nfl: NflPlayer | undefined): (number | null)[] {
  return league.map((v, i) => v ?? nfl?.pts[i] ?? null);
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
