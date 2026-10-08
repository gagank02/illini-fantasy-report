// Fetches FantasyCalc trade values ONCE, computes trade suggestions, and writes ONLY the suggestions to
// src/data/trades.json. The raw values stay in memory and are never saved: they aren't ours to republish.
// Only the daily refresh job runs this, with FANTASYCALC=live. It skips the call if today's trades are
// already saved, so reruns never add calls. Builds never call FantasyCalc; they read the committed file.
import { writeFileSync } from 'node:fs';
import { checkCoverage, keepRostered, mayFetch, queryFor, readSaved, SAVED_PATH, serializeTrades, valuesUrl, type FcValue } from '../src/lib/fantasycalc.ts';
import { scriptPlayers } from '../src/lib/players.ts';
import { currentLeagueId, leagueById, leagueRosters } from '../src/lib/sleeper.ts';
import { tradeBoard, valuedRosters } from '../src/lib/trades.ts';

const today = new Date().toISOString().slice(0, 10);
if (!mayFetch(process.env, readSaved(), today)) {
  console.log(process.env.FANTASYCALC === 'live' ? `Trades already saved for ${today}, skipping.` : 'FANTASYCALC is not live, skipping.');
  process.exit(0);
}

const [league, rosters] = await Promise.all([leagueById(currentLeagueId()), leagueRosters()]);
const query = queryFor(league);
const res = await fetch(valuesUrl(query));
if (!res.ok) throw new Error(`FantasyCalc /values/current returned ${res.status}`);
const body: unknown = await res.json();
if (!Array.isArray(body)) throw new Error('FantasyCalc returned something other than a list. Keeping yesterday\'s trades.');
const rostered = rosters.flatMap(r => r.players ?? []);
const values = keepRostered(body as FcValue[], new Set(rostered), query.isDynasty);

// Check the join with Sleeper before saving. The run log shows any gaps; a broken list is never used.
const players = scriptPlayers();
const c = checkCoverage(values, rostered, players);
console.log(`Coverage: ${c.valued} of ${c.skill} rostered QB/RB/WR/TE have a value.`);
if (c.missing.length) console.log(`No value (left out of trades): ${c.missing.join(', ')}`);
if (c.posMismatch.length) console.log(`Position differs: ${c.posMismatch.join(', ')}`);
if (!c.ok) throw new Error('Too few rostered players have a value, so this list looks broken. Keeping yesterday\'s trades.');

const board = tradeBoard(valuedRosters(rosters, new Map(Object.entries(values))), league.roster_positions);
writeFileSync(SAVED_PATH, serializeTrades(today, query, board));
console.log(`Wrote ${[...board.pairs.values()].flat().length} trade suggestions to ${SAVED_PATH} (no player values saved).`);
