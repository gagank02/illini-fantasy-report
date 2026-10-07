// Fetches FantasyCalc trade values ONCE and writes our rostered players' values to src/data/trade-values.json.
// Only the daily refresh job runs this, with FANTASYCALC=live. It skips the call if today's values are
// already saved, so reruns never add calls. Builds never call FantasyCalc; they read the committed file.
import { writeFileSync } from 'node:fs';
import { keepRostered, mayFetch, queryFor, readSaved, SAVED_PATH, valuesUrl, type FcValue, type SavedValues } from '../src/lib/fantasycalc.ts';
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
const rostered = new Set(rosters.flatMap(r => r.players ?? []));
const saved: SavedValues = { fetched: today, query, values: keepRostered((await res.json()) as FcValue[], rostered, query.isDynasty) };

// One player per line keeps daily diffs readable.
const lines = Object.entries(saved.values).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`);
writeFileSync(SAVED_PATH, `{\n  "fetched": ${JSON.stringify(today)},\n  "query": ${JSON.stringify(query)},\n  "values": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`Wrote ${lines.length} player values to ${SAVED_PATH}`);
