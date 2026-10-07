// npm run report -- [--week N]
// Builds the facts bundle (Sleeper data only), asks Claude (through Claude Code on your subscription) to write
// the report, lints it, retries once with the problems, and writes src/content/reports/{season}/week-{N}.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintReport } from '../src/lib/lint-report.ts';
import { buildFacts } from '../src/lib/report-facts.ts';
import { buildPrompt, fixPrompt, missingSections, parseDraft, REPORT_RULES, toMarkdown } from '../src/lib/report-writer.ts';
import { leagueUsers, loadSeason } from '../src/lib/sleeper.ts';

const MODEL = 'claude-opus-5-5';

const fail = (msg: string): never => {
  console.error(`\n${msg}`);
  process.exit(1);
};

// 1. Which week, and is Claude Code available?
const weekArg = process.argv.indexOf('--week');
const week = weekArg > 0 ? Number(process.argv[weekArg + 1]) : (await loadSeason()).weeks.length;
if (!Number.isInteger(week) || week < 1) fail('Pass a week number, like: npm run report -- --week 4');
if (spawnSync('claude', ['--version'], { encoding: 'utf8' }).status !== 0) {
  fail('The `claude` command (Claude Code) was not found. Install it and log in with your Claude subscription, or set CLAUDE_CODE_OAUTH_TOKEN in CI.');
}

// 2. Facts, from Sleeper only. No outside news feeds: ESPN and Yahoo terms forbid feeding their content to AI tools.
const players = JSON.parse(readFileSync('src/data/players.json', 'utf8'));
const facts = await buildFacts(week, players);

// 3. Ask Claude. Tools off, no user settings or plugins, our own system prompt.
const system = `${readFileSync('writing-style.md', 'utf8')}\n\n${REPORT_RULES}`;
const workdir = mkdtempSync(join(tmpdir(), 'report-'));
function claude(prompt: string): string {
  console.log(`Asking ${MODEL} through Claude Code…`);
  const r = spawnSync('claude', [
    '-p', '--model', MODEL, '--system-prompt', system, '--tools', '', '--strict-mcp-config',
    '--setting-sources', 'project', '--no-session-persistence', '--output-format', 'text',
  ], { input: prompt, cwd: workdir, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 10 * 60_000 });
  if (r.status !== 0) fail(`Claude Code failed (exit ${r.status}). ${r.stderr || r.stdout}\nIf this is a usage limit, rerun later.`);
  return r.stdout;
}

// 4. Check the draft: format, sections, and writing style.
const names = Object.values(players as Record<string, { name: string }>).map(p => p.name);
for (const u of await leagueUsers()) names.push(u.display_name, u.metadata.team_name ?? '');
const date = new Date().toISOString().slice(0, 10);
function check(text: string): { markdown?: string; problems: string[] } {
  let draft;
  try {
    draft = parseDraft(text);
  } catch (err) {
    return { problems: [(err as Error).message] };
  }
  const markdown = toMarkdown({ ...draft, season: facts.season, week, date });
  const problems = [
    ...missingSections(draft.body).map(s => `Missing the "## ${s}" section.`),
    ...lintReport(markdown, names).map(v => `Line ${v.line} breaks the ${v.rule} rule near "${v.snippet}".`),
  ];
  return { markdown, problems };
}

let text = claude(buildPrompt(facts));
let result = check(text);
if (result.problems.length) {
  console.log(`First draft had ${result.problems.length} problem(s). Asking for one fix.`);
  text = claude(fixPrompt(text, result.problems));
  result = check(text);
}

// 5. Write the file, even if problems remain, so you can read it. Exit 1 so CI opens no PR.
const out = `src/content/reports/${facts.season}/week-${week}.md`;
mkdirSync(`src/content/reports/${facts.season}`, { recursive: true });
writeFileSync(out, result.markdown ?? text);
if (result.problems.length) {
  fail(`Wrote ${out}, but it still has problems:\n${result.problems.map(p => `- ${p}`).join('\n')}`);
}
console.log(`Wrote ${out}. It passes the style linter. Read it before publishing.`);
