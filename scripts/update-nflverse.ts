// nflverse, same pattern as Sleeper's player list: the full summary lives in git ignored .cache/nflverse-full.json
// (kept in the workflow's private Actions cache, never committed), downloaded only if it isn't from today, so reruns
// never download again. The repo gets only what our pages show, in src/data/nflverse.json: the weeks that fill gaps
// in rostered players' lines, and the Buy low / Sell high tags. Only the daily refresh job runs this. Builds never fetch.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildNflData, NFL_FULL_PATH, NFLVERSE_PATH, nflverseUrls, parseCsv, readFull, serializeSiteNfl, siteNfl } from '../src/lib/nflverse.ts';
import { scriptPlayers } from '../src/lib/players.ts';
import { loadSeason } from '../src/lib/sleeper.ts';
import { weeklyPoints } from '../src/lib/trends.ts';

// In GitHub Actions, ::notice:: lines also show on the run's public summary page (logs need a login).
const note = (msg: string) => console.log(process.env.GITHUB_ACTIONS ? `::notice::${msg}` : msg);

const today = new Date().toISOString().slice(0, 10);
const { league, rosters, weeks } = await loadSeason();
const season = Number(league.season);

let full = readFull(season);
if (full?.fetched === today) {
  console.log(`nflverse files already downloaded ${today}, reusing them.`);
} else {
  const urls = nflverseUrls(season);
  const download = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}. Keeping yesterday's file.`);
    return parseCsv(await res.text());
  };
  const [ids, stats, expected] = await Promise.all([download(urls.ids), download(urls.stats), download(urls.expected)]);
  full = buildNflData(today, season, { ids, stats, expected });
  mkdirSync(dirname(NFL_FULL_PATH), { recursive: true });
  writeFileSync(NFL_FULL_PATH, JSON.stringify(full));
  note(`Downloaded nflverse: ${Object.keys(full.players).length} players with a Sleeper id and ${season} games.`);
}

// Check the join with Sleeper before saving: a renamed column or a broken file would leave almost nobody.
const players = scriptPlayers();
const skill = rosters.flatMap(r => r.players ?? []).filter(id => ['QB', 'RB', 'WR', 'TE'].includes(players[id]?.pos ?? ''));
const missing = skill.filter(id => !full.players[id]);
note(`nflverse: ${skill.length - missing.length} of ${skill.length} rostered QB/RB/WR/TE matched.`);
if (missing.length) note(`No nflverse games yet: ${missing.map(id => players[id]?.name ?? id).join(', ')}`);
if (missing.length > skill.length / 2) throw new Error('Too few rostered players matched nflverse, so the files look broken. Keeping yesterday\'s file.');

const site = siteNfl(full, skill, id => weeklyPoints(weeks, id));
writeFileSync(NFLVERSE_PATH, serializeSiteNfl(site));
console.log(`Wrote ${Object.keys(site.fill).length} filled lines and ${Object.keys(site.tags).length} tags to ${NFLVERSE_PATH}.`);
