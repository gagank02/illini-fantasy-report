import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { lintReport } from '../src/lib/lint-report';

const names = ['Amon-Ra St. Brown', 'Riceman szn 🥶🧊👌🏽', 'Jaxon Smith-Njigba'];
const doc = (body: string, headline = 'A Clean Headline', lede = 'A clean lede.') =>
  `---\nheadline: "${headline}"\nlede: "${lede}"\nseason: 2026\nweek: 4\ndate: 2026-10-06\n---\n\n${body}\n`;
const rules = (body: string, headline?: string, lede?: string) => lintReport(doc(body, headline, lede), names).map(v => v.rule);

describe('lintReport', () => {
  test('a clean report passes, including markdown bold and headings', () => {
    expect(rules('## Game by game\n\n**Team A 120.50, Team B 99.10.** Team A won by 21.40.')).toEqual([]);
  });

  test.each([
    ['hyphen', 'A game-changer of a week.'],
    ['en dash', 'Weeks 1–4 were rough.'],
    ['em dash', 'He scored — and then left.'],
    ['record with a hyphen', 'They moved to 3-1.'],
  ])('flags dashes: %s', (_, body) => {
    expect(rules(body)).toContain('dash');
  });

  test('names on the allowlist may contain dashes and emoji', () => {
    expect(rules('Amon-Ra St. Brown and Jaxon Smith-Njigba both scored. Riceman szn 🥶🧊👌🏽 lost.')).toEqual([]);
  });

  test.each([
    ['semicolon', 'They won; barely.'],
    ['colon', 'Here is the thing: they lost.'],
    ['emoji', 'What a week 🔥'],
    ['asterisk', 'A stray * in the text.'],
    ['hashtag', 'Big win #blessed'],
    ['html', 'Nice <b>win</b>.'],
  ])('flags %s', (rule, body) => {
    expect(rules(body)).toContain(rule);
  });

  test.each([
    "It's important to note that they lost.",
    'As we can see, the bench was bad.',
    'That trade was a game changer.',
    'That trade was a game-changer.',
    'Let us delve into the box score.',
    'This was not just a win, but a statement.',
    'A real testament to his drafting.',
  ])('flags AI filler: %s', body => {
    expect(rules(body)).toContain('phrase');
  });

  test('checks the headline and lede, but not frontmatter keys or the date', () => {
    expect(rules('Fine.', 'Week 4: Chaos')).toContain('colon');
    expect(rules('Fine.', 'Fine', 'A lede; with a semicolon.')).toContain('semicolon');
    expect(rules('Fine.')).toEqual([]);
  });

  test('reports the line number and a snippet', () => {
    const v = lintReport(doc('Line one.\n\nLine two; oops.'), names);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: 'semicolon', line: 11 });
    expect(v[0]!.snippet).toContain('two; oops');
  });

  test('the hand written week 4 report passes', () => {
    expect(lintReport(readFileSync('src/content/reports/2026/week-4.md', 'utf8'), names)).toEqual([]);
  });
});
