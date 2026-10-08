// Player lists. Sleeper asks that /players/nfl (~5 MB) be called at most once a day.
// 1. The full trimmed list goes to .cache/players-full.json (git ignored, kept in the workflows' Actions
//    cache). It's fetched only if the file isn't from today, so reruns never add calls.
// 2. src/data/players.json (committed) gets only the players our pages use: rosters, this season's games,
//    and this season's draft. Builds read that and never call /players/nfl.
// The daily refresh and weekly report workflows run this and share one cache key per UTC day.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FULL_PATH, readFull, SITE_PATH, type FullPlayers } from '../src/lib/players.ts';
import { draftPicks, loadSeason } from '../src/lib/sleeper.ts';
import { siteIds, siteSubset, trimPlayers, type Players } from '../src/lib/stats.ts';

// In GitHub Actions, ::notice:: lines also show on the run's public summary page (logs need a login).
const note = (msg: string) => console.log(process.env.GITHUB_ACTIONS ? `::notice::${msg}` : msg);

const today = new Date().toISOString().slice(0, 10);
let full = readFull();
if (full?.fetched === today) {
  console.log(`Full player list already fetched ${today}, reusing it.`);
} else {
  const res = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!res.ok) throw new Error(`Sleeper /players/nfl returned ${res.status}`);
  full = { fetched: today, players: trimPlayers((await res.json()) as Record<string, Record<string, unknown>>) } satisfies FullPlayers;
  mkdirSync(dirname(FULL_PATH), { recursive: true });
  writeFileSync(FULL_PATH, JSON.stringify(full));
  const injured = Object.values(full.players).filter(p => p.injury);
  // Sleeper's docs don't show injury_body_part, so log how many came back; 0 means the field isn't sent.
  note(`Fetched ${Object.keys(full.players).length} players (${injured.length} injured, ${injured.filter(p => p.body).length} with a body part).`);
}

const season = await loadSeason();
const picks = await draftPicks(season.league.draft_id).catch(() => []);
const site: Players = siteSubset(full.players, siteIds(season.rosters, season.weeks, picks));
// One player per line keeps daily diffs readable.
const lines = Object.entries(site).map(([id, p]) => `${JSON.stringify(id)}:${JSON.stringify(p)}`);
writeFileSync(SITE_PATH, `{\n${lines.join(',\n')}\n}\n`);
console.log(`Wrote ${lines.length} players our pages use to ${SITE_PATH}.`);
