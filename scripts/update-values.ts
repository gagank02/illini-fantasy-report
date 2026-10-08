// Fetches FantasyCalc trade values ONCE and writes our rostered players' values to src/data/trade-values.json.
// Only the daily refresh job runs this, with FANTASYCALC=live. It skips the call if today's values are
// already saved, so reruns never add calls. Builds never call FantasyCalc; they read the committed file.
import { readFileSync, writeFileSync } from 'node:fs';
import { checkCoverage, keepRostered, mayFetch, queryFor, readSaved, SAVED_PATH, valuesUrl, type FcValue, type SavedValues } from '../src/lib/fantasycalc.ts';
import { leagueById, leagueRosters, currentLeagueId } from '../src/lib/sleeper.ts';

const today = new Date().toISOString().slice(0, 10);
if (!mayFetch(process.env, readSaved(), today)) {
  console.log(process.env.FANTASYCALC === 'live' ? `Values already saved for ${today}, skipping.` : 'FANTASYCALC is not live, skipping.');
  process.exit(0);
}

const [league, rosters] = await Promise.all([leagueById(currentLeagueId()), leagueRosters()]);
const query = queryFor(league);
const res = await fetch(valuesUrl(query));
if (!res.ok) throw new Error(`FantasyCalc /values/current returned ${res.status}`);
const body: unknown = await res.json();
if (!Array.isArray(body)) throw new Error('FantasyCalc returned something other than a list. Keeping yesterday\'s values.');
const rostered = rosters.flatMap(r => r.players ?? []);
const saved: SavedValues = { fetched: today, query, values: keepRostered(body as FcValue[], new Set(rostered), query.isDynasty) };

// Check the join with Sleeper before saving. The run log shows any gaps; a broken list is never saved.
const players = JSON.parse(readFileSync('src/data/players.json', 'utf8'));
const c = checkCoverage(saved.values, rostered, players);
console.log(`Coverage: ${c.valued} of ${c.skill} rostered QB/RB/WR/TE have a value.`);
if (c.missing.length) console.log(`No value (left out of trades): ${c.missing.join(', ')}`);
if (c.posMismatch.length) console.log(`Position differs: ${c.posMismatch.join(', ')}`);
if (!c.ok) throw new Error('Too few rostered players have a value, so this list looks broken. Keeping yesterday\'s values.');

// One player per line keeps daily diffs readable.
const lines = Object.entries(saved.values).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`);
writeFileSync(SAVED_PATH, `{\n  "fetched": ${JSON.stringify(today)},\n  "query": ${JSON.stringify(query)},\n  "values": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`Wrote ${lines.length} player values to ${SAVED_PATH}`);
