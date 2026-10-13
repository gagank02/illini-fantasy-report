// Link preview cards (Open Graph images), drawn at build time and rasterized with resvg.
// Never fetches anything: fonts come from public/fonts. Text is drawn as glyph outlines with fontkit,
// which (unlike resvg's text engine) applies the variable font's weight and lining figures, so
// usernames like "fr0sty" don't render their zero as an "o". Emoji are dropped: there is no emoji font.
import * as fontkit from 'fontkit';
import { Resvg } from '@resvg/resvg-js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Relative to the project root (not import.meta.url, which moves when Astro bundles this file).
const open = (file: string) => fontkit.openSync(`public/fonts/${file}`) as fontkit.Font;
const playfair = open('PlayfairDisplay[wght].ttf');
const fonts = {
  // Same weights as .headline (800) and body text on the site.
  headline: playfair.getVariation({ wght: 800 }),
  kicker: playfair.getVariation({ wght: 500 }),
  masthead: open('UnifrakturMaguntia-Book.ttf'),
};
const FEATURES = ['lnum', 'kern', 'liga'];

const INK = '#1d1b17';
const PAPER = '#f3eee2';
const NAVY = '#13294b';
const ORANGE = '#ff5f05';
const ACCENT = '#b53d00';

const SIDE = 72;
const TEXT_WIDTH = OG_WIDTH - SIDE * 2;
const HEADLINE_TOP = 232;
const HEADLINE_BOTTOM = 590;
const LINE_HEIGHT = 1.12;

/** Removes emoji (with skin tones, joiners and variation selectors) and tidies the spaces left behind. */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]/gu, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function width(font: fontkit.Font, text: string, size: number, tracking = 0): number {
  const run = font.layout(text, FEATURES);
  return (run.advanceWidth * size) / font.unitsPerEm + tracking * run.glyphs.length;
}

/** SVG path data for one line of text, with its baseline starting at (x, y). */
function textPath(font: fontkit.Font, text: string, size: number, x: number, y: number, tracking = 0): string {
  const run = font.layout(text, FEATURES);
  const scale = size / font.unitsPerEm;
  let cx = x;
  return run.glyphs
    .map((glyph, i) => {
      const pos = run.positions[i]!;
      // Font units are y-up; SVG is y-down.
      const d = glyph.path.transform(scale, 0, 0, -scale, cx + pos.xOffset * scale, y - pos.yOffset * scale).toSVG();
      cx += pos.xAdvance * scale + tracking;
      return d;
    })
    .join('');
}

/** Greedy word wrap; null when a single word is wider than the line. */
function wrap(text: string, size: number): string[] | null {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (width(fonts.headline, word, size) > TEXT_WIDTH) return null;
    const next = line ? `${line} ${word}` : word;
    if (width(fonts.headline, next, size) <= TEXT_WIDTH) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest size whose wrapped headline fits the space under the masthead. */
export function layoutHeadline(text: string): { size: number; lines: string[] } {
  for (let size = 80; size >= 36; size -= 4) {
    const lines = wrap(text, size);
    if (lines && lines.length * size * LINE_HEIGHT <= HEADLINE_BOTTOM - HEADLINE_TOP) return { size, lines };
  }
  return { size: 36, lines: wrap(text, 36) ?? [text] };
}

export interface Card {
  /** Small line above the headline, e.g. "Week 4 · October 7, 2026". */
  kicker: string;
  headline: string;
}

export function cardSvg({ kicker, headline }: Card): string {
  const { size, lines } = layoutHeadline(stripEmoji(headline) || 'The Illini Fantasy Report');
  const step = size * LINE_HEIGHT;
  // Centre the block; a baseline sits about 0.9 of the font size below the top of its line.
  const top = HEADLINE_TOP + (HEADLINE_BOTTOM - HEADLINE_TOP - lines.length * step) / 2;
  const headlinePath = lines.map((l, i) => textPath(fonts.headline, l, size, SIDE, top + i * step + size * 0.9)).join('');

  const mastSize = 70;
  const mast = 'The Illini Fantasy Report';
  const mastX = (OG_WIDTH - width(fonts.masthead, mast, mastSize)) / 2;
  const kickerText = stripEmoji(kicker).toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${PAPER}"/>
  <rect width="${OG_WIDTH}" height="16" fill="${ORANGE}"/>
  <path fill="${NAVY}" d="${textPath(fonts.masthead, mast, mastSize, mastX, 112)}"/>
  <rect x="${SIDE}" y="140" width="${TEXT_WIDTH}" height="3" fill="${INK}"/>
  <rect x="${SIDE}" y="148" width="${TEXT_WIDTH}" height="3" fill="${INK}"/>
  <path fill="${ACCENT}" d="${textPath(fonts.kicker, kickerText, 28, SIDE, 204, 3)}"/>
  <path fill="${INK}" d="${headlinePath}"/>
  <rect y="${OG_HEIGHT - 16}" width="${OG_WIDTH}" height="16" fill="${NAVY}"/>
</svg>`;
}

export function renderCard(card: Card): Buffer {
  return new Resvg(cardSvg(card)).render().asPng();
}
