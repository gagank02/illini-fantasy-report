// Fetches Sleeper's full player list ONCE and writes a trimmed copy to src/data/players.json.
// Sleeper asks that /players/nfl (~5 MB) be called at most once a day. Builds never call it;
// they read the committed file. The daily refresh and weekly report workflows run this, sharing a
// dated cache so the two together call it at most once per UTC day.
import { writeFileSync } from 'node:fs';
import { trimPlayers } from '../src/lib/stats.ts';

const res = await fetch('https://api.sleeper.app/v1/players/nfl');
if (!res.ok) throw new Error(`Sleeper /players/nfl returned ${res.status}`);
const trimmed = trimPlayers((await res.json()) as Record<string, Record<string, unknown>>);

// One player per line keeps daily diffs readable.
const lines = Object.entries(trimmed).map(([id, p]) => `${JSON.stringify(id)}:${JSON.stringify(p)}`);
writeFileSync('src/data/players.json', `{\n${lines.join(',\n')}\n}\n`);
const injured = Object.values(trimmed).filter(p => p.injury);
// Sleeper's docs don't show injury_body_part, so log how many came back; 0 means the field isn't sent.
console.log(`Wrote ${lines.length} players to src/data/players.json (${injured.length} injured, ${injured.filter(p => p.body).length} with a body part)`);
