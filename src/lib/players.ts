// Where the player lists live. Sleeper's full list (~4,300 players) never goes in the repo: it sits in a
// git ignored file that the workflows keep in their private Actions cache. The repo gets only the players
// our pages use (src/data/players.json), the same names the public site shows anyway.
import { existsSync, readFileSync } from 'node:fs';
import type { Players } from './stats.ts';

export const SITE_PATH = 'src/data/players.json';
export const FULL_PATH = '.cache/players-full.json';

export interface FullPlayers {
  /** UTC date Sleeper's list was fetched, e.g. "2026-10-08". */
  fetched: string;
  players: Players;
}

export function readFull(path = FULL_PATH): FullPlayers | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as FullPlayers) : null;
}

/** For scripts (reports, linting, trades): the full list when present, else the committed site subset. */
export function scriptPlayers(): Players {
  return readFull()?.players ?? (JSON.parse(readFileSync(SITE_PATH, 'utf8')) as Players);
}
