// Fetches Sleeper's full player list ONCE and writes a trimmed copy to src/data/players.json.
// Sleeper asks that /players/nfl (~5 MB) be called at most once a day. Builds never call it;
// they read the committed file. The weekly report Action runs this script.
import { writeFileSync } from 'node:fs';

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

interface SleeperPlayer {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string;
  team?: string | null;
  injury_status?: string | null;
}

const res = await fetch('https://api.sleeper.app/v1/players/nfl');
if (!res.ok) throw new Error(`Sleeper /players/nfl returned ${res.status}`);
const all = (await res.json()) as Record<string, SleeperPlayer>;

const trimmed: Record<string, { name: string; pos: string; team: string | null; injury: string | null }> = {};
for (const id of Object.keys(all).sort()) {
  const p = all[id]!;
  if (!p.position || !POSITIONS.has(p.position)) continue;
  trimmed[id] = {
    name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
    pos: p.position,
    team: p.team ?? null,
    injury: p.injury_status ?? null,
  };
}

// One player per line keeps weekly diffs readable.
const lines = Object.entries(trimmed).map(([id, p]) => `${JSON.stringify(id)}:${JSON.stringify(p)}`);
writeFileSync('src/data/players.json', `{\n${lines.join(',\n')}\n}\n`);
console.log(`Wrote ${lines.length} players to src/data/players.json`);
