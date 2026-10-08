// npm run lint:report -- <file.md> [...more]
// Exits 1 and lists every writing-style.md violation. Player, team, and manager names are allowed as is.
import { readFileSync } from 'node:fs';
import { lintReport } from '../src/lib/lint-report.ts';
import { scriptPlayers } from '../src/lib/players.ts';
import { leagueUsers } from '../src/lib/sleeper.ts';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run lint:report -- <report.md> [...]');
  process.exit(2);
}

const players = scriptPlayers();
const names = Object.values(players).map(p => p.name);
try {
  for (const u of await leagueUsers()) names.push(u.display_name, u.metadata.team_name ?? '');
} catch (err) {
  // Fails safe: without league names, a team name with a dash or emoji gets flagged rather than missed.
  console.warn(`Could not load league names from Sleeper (${(err as Error).message}). Linting with player names only.`);
}

let failed = false;
for (const file of files) {
  const violations = lintReport(readFileSync(file, 'utf8'), names);
  for (const v of violations) console.log(`${file}:${v.line}  ${v.rule}  "${v.snippet}"`);
  if (violations.length) failed = true;
  else console.log(`${file}: clean`);
}
process.exit(failed ? 1 : 0);
