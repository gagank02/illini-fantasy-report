// Downloads this season's nflverse files ONCE and writes a small summary for rostered QB/RB/WR/TE to
// src/data/nflverse.json: PPR points by week and actual vs expected points per game. Only the daily refresh job
// runs this. It skips if today's file is already saved, so reruns never download again. Builds never fetch.
import { writeFileSync } from 'node:fs';
import { buildNflData, loadNflverse, NFLVERSE_PATH, nflverseUrls, parseCsv, serializeNflData } from '../src/lib/nflverse.ts';
import { scriptPlayers } from '../src/lib/players.ts';
import { currentLeagueId, leagueById, leagueRosters } from '../src/lib/sleeper.ts';

// In GitHub Actions, ::notice:: lines also show on the run's public summary page (logs need a login).
const note = (msg: string) => console.log(process.env.GITHUB_ACTIONS ? `::notice::${msg}` : msg);

const today = new Date().toISOString().slice(0, 10);
const [league, rosters] = await Promise.all([leagueById(currentLeagueId()), leagueRosters()]);
const season = Number(league.season);
if (loadNflverse(season)?.fetched === today) {
  console.log(`nflverse data already saved for ${today}, skipping.`);
  process.exit(0);
}

const urls = nflverseUrls(season);
const download = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}. Keeping yesterday's file.`);
  return parseCsv(await res.text());
};
const [ids, stats, expected] = await Promise.all([download(urls.ids), download(urls.stats), download(urls.expected)]);

const players = scriptPlayers();
const skill = rosters.flatMap(r => r.players ?? []).filter(id => ['QB', 'RB', 'WR', 'TE'].includes(players[id]?.pos ?? ''));
const data = buildNflData(today, season, skill, { ids, stats, expected });

// Check the join with Sleeper before saving: a renamed column or a broken file would leave almost nobody.
const found = Object.keys(data.players).length;
note(`nflverse: ${found} of ${skill.length} rostered QB/RB/WR/TE matched, ${Object.values(data.players).filter(p => p.games).length} with expected points.`);
const missing = skill.filter(id => !data.players[id]).map(id => players[id]?.name ?? id);
if (missing.length) note(`No nflverse games yet: ${missing.join(', ')}`);
if (found < skill.length / 2) throw new Error('Too few rostered players matched nflverse, so the files look broken. Keeping yesterday\'s file.');

writeFileSync(NFLVERSE_PATH, serializeNflData(data));
console.log(`Wrote ${found} players to ${NFLVERSE_PATH}.`);
