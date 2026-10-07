// Checks a report's prose against writing-style.md. No imports, so scripts/ can run it with plain Node.

export interface Violation {
  line: number;
  rule: 'dash' | 'semicolon' | 'colon' | 'emoji' | 'asterisk' | 'hashtag' | 'html' | 'phrase';
  snippet: string;
}

const RULES: [Violation['rule'], RegExp][] = [
  ['dash', /[-‐-―−]/],
  ['semicolon', /;/],
  ['colon', /:/],
  ['emoji', /\p{Extended_Pictographic}/u],
  ['asterisk', /\*/],
  ['hashtag', /(^|\s)#\w/],
  ['html', /<\/?[a-z][^>]*>/i],
];

// From writing-style.md, plus a few stock AI phrases. Matched case insensitive, apostrophes normalized.
const PHRASES = [
  /it'?s important to note/i, /as we can see/i, /game[ -]?changer/i, /\bstreamline/i, /\bboosting\b/i,
  /let'?s explore/i, /fascinating/i, /\bnot just\b[^.]*\bbut\b/i, /\bdelve/i, /\btapestry\b/i, /testament to/i,
  /cutting edge/i, /unparalleled/i, /in conclusion/i, /move the needle/i, /mission critical/i, /touch base/i,
];

/** Lints prose: the headline and lede values in frontmatter, then every body line. */
export function lintReport(src: string, allowedNames: string[]): Violation[] {
  const names = allowedNames.filter(Boolean).sort((a, b) => b.length - a.length);
  const lines = src.split('\n');
  const out: Violation[] = [];
  const fmEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;

  lines.forEach((raw, i) => {
    let text: string;
    if (i <= fmEnd) {
      const m = raw.match(/^(headline|lede):\s*"?(.*?)"?\s*$/);
      if (!m) return;
      text = m[2]!;
    } else {
      text = raw;
    }
    const prose = clean(text, names);
    for (const [rule, re] of RULES) if (re.test(prose)) out.push({ line: i + 1, rule, snippet: snippet(raw, re) });
    const p = PHRASES.find(re => re.test(prose));
    if (p) out.push({ line: i + 1, rule: 'phrase', snippet: snippet(raw.replace(/’/g, "'"), p) });
  });
  return out;
}

/** Remove allowed names and markdown syntax so only visible prose is checked. */
function clean(text: string, names: string[]): string {
  let t = text;
  for (const n of names) t = t.split(n).join(' NAME ');
  return t
    .replace(/’/g, "'")
    .replace(/^#{1,6}\s/, '') // heading marker
    .replace(/\*\*|__/g, '') // bold markers
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // link text only, not the URL
}

function snippet(line: string, re: RegExp): string {
  const m = line.match(re);
  const at = m?.index ?? 0;
  return line.slice(Math.max(0, at - 25), at + 25).trim();
}
