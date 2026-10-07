// Pure helpers for the weekly report writer (scripts/write-report.ts). No imports, so plain Node runs it.

/** Report sections, in order. "NFL news" is only required when there are headlines. */
export const SECTIONS = [
  'Game by game',
  'Player of the week',
  'Bust of the week',
  'Bench blunders',
  'Stock up and stock down',
  'Transactions',
  'Injury report',
  'NFL news',
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
NFL news. Pick 3 to 5 headlines that matter for fantasy. Restate each in your own words. Never copy ESPN wording.
Use only what each headline and description actually says. Never add details, predictions, or a different story.
Skip stories about crimes, lawsuits, trials, discipline, health or mental health, and personal matters, even for fantasy relevant players.
Next week. One line per matchup with a pick, based only on records, last3, and powerRank. Call it a pick, not a projection.

Aim for 900 to 1300 words in the body.
`.trim();

export interface Headline {
  title: string;
  description: string;
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();

/** Item titles and descriptions from an RSS feed. Regex, not a parser: we only need two fields. */
export function parseRss(xml: string, limit = 10): Headline[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(([, item]) => ({
    title: decode(item!.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
    description: decode(item!.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ''),
  })).filter(h => h.title);
}

/** Fallback source: ESPN's JSON news endpoint (a different host from the RSS feed). */
export function parseEspnJson(json: unknown, limit = 10): Headline[] {
  const articles = (json as { articles?: { headline?: string; description?: string }[] } | null)?.articles;
  if (!Array.isArray(articles)) return [];
  return articles
    .filter(a => a?.headline)
    .slice(0, limit)
    .map(a => ({ title: a.headline!.trim(), description: (a.description ?? '').trim() }));
}

export function buildPrompt(facts: unknown, headlines: Headline[]): string {
  const sections = SECTIONS.filter(s => s !== 'NFL news' || headlines.length > 0);
  return [
    'Write this week\'s report from these facts.',
    '',
    'Required sections, in this order:',
    ...sections.map(s => `## ${s}`),
    '',
    'Facts (JSON):',
    '```json',
    JSON.stringify(facts, null, 1),
    '```',
    '',
    headlines.length
      ? ['NFL headlines from ESPN (inputs only, restate in your own words):', ...headlines.map(h => `- ${h.title}. ${h.description}`)].join('\n')
      : 'No NFL headlines this week. Leave out the NFL news section.',
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

export function missingSections(body: string, hasNews: boolean): string[] {
  const headings = new Set([...body.matchAll(/^## (.+)$/gm)].map(m => m[1]!.trim()));
  return SECTIONS.filter(s => (s !== 'NFL news' || hasNews) && !headings.has(s));
}

export function toMarkdown(r: { headline: string; lede: string; season: number; week: number; date: string; body: string }): string {
  return `---\nheadline: ${JSON.stringify(r.headline)}\nlede: ${JSON.stringify(r.lede)}\nseason: ${r.season}\nweek: ${r.week}\ndate: ${r.date}\n---\n\n${r.body}\n`;
}
