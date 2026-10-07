import { describe, expect, test } from 'vitest';
import { buildPrompt, missingSections, parseDraft, REPORT_RULES, SECTIONS, toMarkdown } from '../src/lib/report-writer';

describe('buildPrompt', () => {
  test('includes the facts as JSON and every required section, with no outside news', () => {
    const prompt = buildPrompt({ season: 2026, week: 4, games: [] });
    expect(prompt).toContain('"week": 4');
    for (const sec of SECTIONS) expect(prompt).toContain(`## ${sec}`);
    expect(SECTIONS).toContain('Fantasy news');
    expect(SECTIONS).not.toContain('NFL news');
    expect(prompt).not.toMatch(/ESPN|headline from|RSS/i);
  });
});

describe('parseDraft', () => {
  const body = SECTIONS.map(s => `## ${s}\n\nText for ${s}.`).join('\n\n');

  test('splits the headline, lede, and body', () => {
    expect(parseDraft(`HEADLINE: Big Week\nLEDE: Someone won big.\nBODY\n${body}`)).toEqual({ headline: 'Big Week', lede: 'Someone won big.', body });
  });

  test('tolerates a code fence and extra blank lines', () => {
    expect(parseDraft('```markdown\n\nHEADLINE: A\n\nLEDE: B\n\nBODY\n\n## Game by game\n\nX\n```').body).toBe('## Game by game\n\nX');
  });

  test('throws when the format is missing', () => {
    expect(() => parseDraft('Here is your report!')).toThrow(/HEADLINE/);
  });
});

describe('missingSections', () => {
  test('lists required sections that are absent', () => {
    const all = SECTIONS.map(s => `## ${s}`).join('\n');
    expect(missingSections(all)).toEqual([]);
    expect(missingSections(all.replace('## Bench blunders', ''))).toEqual(['Bench blunders']);
    expect(missingSections(all.replace('## Fantasy news', ''))).toEqual(['Fantasy news']);
  });
});

describe('toMarkdown', () => {
  test('writes frontmatter the content schema accepts, quoting safely', () => {
    const md = toMarkdown({ headline: 'He said "wow"', lede: 'A lede.', season: 2026, week: 4, date: '2026-10-06', body: '## Game by game\n\nX' });
    expect(md).toBe('---\nheadline: "He said \\"wow\\""\nlede: "A lede."\nseason: 2026\nweek: 4\ndate: 2026-10-06\n---\n\n## Game by game\n\nX\n');
  });
});

describe('REPORT_RULES guard rails (each came from a real bad draft)', () => {
  test.each([
    ['no gendered pronouns for managers', /Never use he, she/],
    ['superlatives need the whole list', /Check the full list/],
    ['facts only', /Never invent stats/],
    ['no invented context like divisions or rivalries', /divisions, rivalries/],
    ['no outside news: the model must not use its own memory of NFL events', /You have no news sources/],
    ['fantasy news comes only from injuries and Sleeper trending data', /Fantasy news\. Use only injuries and trending/],
  ])('%s', (_, re) => {
    expect(REPORT_RULES).toMatch(re);
  });
});
