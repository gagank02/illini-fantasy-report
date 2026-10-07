// Pure helpers for the weekly report writer (scripts/write-report.ts). No imports, so plain Node runs it.

/** Report sections, in order. All required. */
export const SECTIONS = [
  'Game by game',
  'Player of the week',
  'Bust of the week',
  'Bench blunders',
  'Stock up and stock down',
  'Transactions',
  'Injury report',
  'Fantasy news',
  'Next week',
] as const;

/** Appended to writing-style.md to form the system prompt. */
export const REPORT_RULES = `
You write the weekly newspaper report for the Illini Fantasy league, a 12 team fantasy football league of friends.

Facts
Use only the facts in the JSON you are given. Every number, score, record, name, injury, and transaction must come from it.
Never invent stats, news, injury details, reasons, quotes, or projections. If a section has nothing to report, say so in one short sentence.
Never invent league context the facts don't contain, like divisions, rivalries, past seasons, or history between managers.
Copy team names, manager names, and player names exactly as given, even if they contain emoji or unusual characters.
Write records as words, like 3 and 1. Never write 3-1.
Only call a team or player first, best, most, worst, or the league leader when the facts show it across the whole list. Check the full list before you claim it.

Tone
Friendly trash talk, by name. Call out managers by their username and teams by their team name.
Aim jabs at decisions and results: bad starts, points left on the bench, blowouts, waiver misses, bad drops.
Never joke about anything personal, real life, appearance, or intelligence. Keep it fun for the person being roasted.
You don't know any manager's gender. Refer to managers by username, team name, or they. Never use he, she, him, her, his, guy, or similar for a manager.

Structure
Return plain text in exactly this format and nothing else:
HEADLINE: one punchy headline under 12 words
LEDE: one or two sentences that tell the biggest story of the week
BODY
then the markdown body, using the required ## sections in the given order.

Game by game. One short paragraph per game. Start each with the bold score, like **Team A 120.50, Team B 99.10.**
Player of the week and Bust of the week. One player each, with the number.
Bench blunders. Use benchBlunders, coachOfTheWeek, and worstCoach. Lead with anyone whose bench would have won a loss.
Stock up and stock down. Use powerMovers. Explain the move with numbers from the facts.
Transactions. Highlight the interesting moves, not every one. Call out droppedAndScored if present.
Injury report. List injured starters and whose team they hurt.
Fantasy news. Use only injuries and trending from the facts. Trending lists the players most added and dropped across all Sleeper leagues. rosteredBy says which team in our league has each player. Only suggest picking up a player whose rosteredBy is null. Point out trending pickups that could help a team in this league, and trending drops on our rosters.
You have no news sources. Never mention NFL games, trades, signings, suspensions, coaching news, or any event that is not in the facts, even if you remember it.
Next week. One line per matchup with a pick, based only on records, last3, and powerRank. Call it a pick, not a projection.

Aim for 900 to 1300 words in the body.
`.trim();

// No outside news feeds: ESPN (Disney) and Yahoo terms forbid automated collection and use with AI tools.
// Everything comes from Sleeper, whose API is free for non-commercial use.
export function buildPrompt(facts: unknown): string {
  return [
    'Write this week\'s report from these facts.',
    '',
    'Required sections, in this order:',
    ...SECTIONS.map(s => `## ${s}`),
    '',
    'Facts (JSON):',
    '```json',
    JSON.stringify(facts, null, 1),
    '```',
  ].join('\n');
}

export function fixPrompt(draft: string, problems: string[]): string {
  return [
    'Your report broke these rules. Fix every one and return the whole report again in the same format.',
    ...problems.map(p => `- ${p}`),
    '',
    'Your report:',
    draft,
  ].join('\n');
}

export function parseDraft(text: string): { headline: string; lede: string; body: string } {
  const lines = text.replace(/^```\w*\s*$/gm, '').split('\n');
  const find = (label: string) => lines.findIndex(l => l.trim().startsWith(label));
  const [h, l, b] = [find('HEADLINE:'), find('LEDE:'), lines.findIndex(x => x.trim() === 'BODY')];
  if (h < 0 || l < 0 || b < 0) throw new Error('Draft is missing the HEADLINE, LEDE, or BODY line.');
  return {
    headline: lines[h]!.trim().slice('HEADLINE:'.length).trim(),
    lede: lines[l]!.trim().slice('LEDE:'.length).trim(),
    body: lines.slice(b + 1).join('\n').trim(),
  };
}

export function missingSections(body: string): string[] {
  const headings = new Set([...body.matchAll(/^## (.+)$/gm)].map(m => m[1]!.trim()));
  return SECTIONS.filter(s => !headings.has(s));
}

export function toMarkdown(r: { headline: string; lede: string; season: number; week: number; date: string; body: string }): string {
  return `---\nheadline: ${JSON.stringify(r.headline)}\nlede: ${JSON.stringify(r.lede)}\nseason: ${r.season}\nweek: ${r.week}\ndate: ${r.date}\n---\n\n${r.body}\n`;
}
