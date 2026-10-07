import { describe, expect, test } from 'vitest';
import { buildPrompt, missingSections, parseDraft, parseEspnJson, parseRss, REPORT_RULES, SECTIONS, toMarkdown } from '../src/lib/report-writer';

describe('parseRss', () => {
  const xml = `<rss><channel><title><![CDATA[www.espn.com - NFL]]></title>
    <item><title><![CDATA[Eagles RT out 4 weeks with knee injury]]></title><description><![CDATA[The All&#39;Pro tackle &amp; captain will miss time.]]></description></item>
    <item><title>Plain title &quot;quoted&quot;</title><description>No CDATA here</description></item>
  </channel></rss>`;

  test('reads item titles and descriptions, not the channel title, and decodes entities', () => {
    expect(parseRss(xml)).toEqual([
      { title: 'Eagles RT out 4 weeks with knee injury', description: "The All'Pro tackle & captain will miss time." },
      { title: 'Plain title "quoted"', description: 'No CDATA here' },
    ]);
  });

  test('decodes numeric entities and trims whitespace (CBS style)', () => {
    const xml = '<rss><item><title>\n   Eagles&#039; Lane Johnson retires &#8217;26  \n</title><description>A&#x27;s</description></item></rss>';
    expect(parseRss(xml)).toEqual([{ title: "Eagles' Lane Johnson retires \u201926", description: "A's" }]);
  });

  test('caps the number of items and survives junk', () => {
    const many = '<rss>' + Array.from({ length: 30 }, (_, i) => `<item><title>T${i}</title></item>`).join('') + '</rss>';
    expect(parseRss(many, 10)).toHaveLength(10);
    expect(parseRss('not xml at all')).toEqual([]);
  });
});

describe('parseEspnJson (fallback when the RSS feed fails)', () => {
  test('reads headline and description from articles, skipping empty ones', () => {
    const json = { articles: [{ headline: 'QB out', description: 'Ankle sprain' }, { headline: '' }, { headline: 'No desc' }] };
    expect(parseEspnJson(json)).toEqual([
      { title: 'QB out', description: 'Ankle sprain' },
      { title: 'No desc', description: '' },
    ]);
  });
  test('survives an unexpected shape', () => {
    expect(parseEspnJson(null)).toEqual([]);
    expect(parseEspnJson({ nope: 1 })).toEqual([]);
  });
});

describe('buildPrompt', () => {
  test('includes the facts as JSON and the headlines, and drops the news section without headlines', () => {
    const facts = { season: 2026, week: 4, games: [] };
    const withNews = buildPrompt(facts, [{ title: 'Big injury', description: 'Out for the year' }], 'CBS Sports');
    expect(withNews).toContain('"week": 4');
    expect(withNews).toContain('Big injury');
    expect(withNews).toContain('## NFL news');
    expect(withNews).toContain('NFL headlines from CBS Sports');
    const noNews = buildPrompt(facts, [], '');
    expect(noNews).not.toContain('## NFL news');
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
  test('lists required sections that are absent; NFL news only required with headlines', () => {
    const all = SECTIONS.map(s => `## ${s}`).join('\n');
    expect(missingSections(all, true)).toEqual([]);
    expect(missingSections(all.replace('## Bench blunders', ''), true)).toEqual(['Bench blunders']);
    expect(missingSections(all.replace('## NFL news', ''), false)).toEqual([]);
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
    ['news only from the headline, no invented details', /Never add details, predictions, or a different story/],
    ['skip crime, legal, and health stories', /Skip stories about crimes, lawsuits, trials/],
    ['never copy the source\'s wording', /Never copy the source's wording/],
    ['facts only', /Never invent stats/],
    ['no invented context like divisions or rivalries', /divisions, rivalries/],
  ])('%s', (_, re) => {
    expect(REPORT_RULES).toMatch(re);
  });
});
