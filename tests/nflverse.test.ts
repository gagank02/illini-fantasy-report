import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { buildNflData, fillWeeks, loadNflverse, luck, nflverseUrls, parseCsv, serializeNflData, type NflPlayer } from '../src/lib/nflverse';
import { trendRows } from '../src/lib/trends';
import type { Matchup } from '../src/lib/sleeper';
import type { Players } from '../src/lib/stats';

const csv = (rows: string[][]) => parseCsv(rows.map(r => r.join(',')).join('\n'));
const player = (p: Partial<NflPlayer>): NflPlayer => ({ pts: [], games: 0, act: 0, exp: 0, ...p });

test('parses CSV with quoted commas, escaped quotes, CRLF and a trailing newline', () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,\n');
  expect(rows).toEqual([{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: '2', b: '', c: '' }]);
});

test('downloads only plain CSV from nflverse and ffverse GitHub releases', () => {
  for (const url of Object.values(nflverseUrls(2026))) {
    expect(url).toMatch(/^https:\/\/github\.com\/(nflverse\/nflverse-data|ffverse\/ffopportunity)\/releases\/download\/.+_2026\.csv$/);
  }
});

test('joins on gsis id, keeps only wanted Sleeper ids, regular season weeks, byes as null', () => {
  const ids = csv([['sleeper_id', 'gsis_id'], ['100', 'G1'], ['100', 'G1'], ['200', 'G2'], ['', 'G3']]);
  const stats = csv([
    ['player_id', 'season_type', 'week', 'fantasy_points_ppr'],
    ['G1', 'REG', '1', '12.34'],
    ['G1', 'REG', '3', '0'],
    ['G1', 'POST', '19', '30'],
    ['G2', 'REG', '1', '9'],
    ['G3', 'REG', '1', '40'],
  ]);
  const expected = csv([
    ['player_id', 'week', 'total_fantasy_points', 'total_fantasy_points_exp'],
    ['G1', '1', '12', '20'],
    ['G1', '3', '0', '10'],
    ['G1', '19', '30', '1'],
  ]);
  const d = buildNflData('2026-10-09', 2026, ['100'], { ids, stats, expected });
  expect(Object.keys(d.players)).toEqual(['100']);
  expect(d.players['100']).toEqual({ pts: [12.3, null, 0], games: 2, act: 6, exp: 15 });
});

test('the saved file round trips, and last season\'s file is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nflverse-'));
  const path = join(dir, 'nflverse.json');
  const d = { fetched: '2026-10-09', season: 2026, players: { '200': player({ pts: [1, null] }), '100': player({ games: 3, act: 5, exp: 10 }) } };
  writeFileSync(path, serializeNflData(d));
  expect(loadNflverse(2026, path)).toEqual(d);
  expect(loadNflverse(2027, path)).toBeNull();
  expect(loadNflverse(2026, join(dir, 'missing.json'))).toBeNull();
});

test('fills only weeks without league points, so our league\'s own numbers always win', () => {
  expect(fillWeeks([10, null, null, 4], player({ pts: [99, 7, null, 99] }))).toEqual([10, 7, null, 4]);
  expect(fillWeeks([null, 3], undefined)).toEqual([null, 3]);
});

test('buy low and sell high need a real gap, enough games, and a player who matters', () => {
  expect(luck(player({ games: 4, act: 4.4, exp: 9.9 }))?.kind).toBe('buy');
  expect(luck(player({ games: 4, act: 29.2, exp: 19.2 }))?.kind).toBe('sell');
  expect(luck(player({ games: 4, act: 15, exp: 10.5 }))).toBeNull(); // gap under 5
  expect(luck(player({ games: 2, act: 2, exp: 12 }))).toBeNull(); // too few games
  expect(luck(player({ games: 4, act: 1, exp: 6 }))).toBeNull(); // deep bench
  expect(luck(undefined)).toBeNull();
});

test('trend rows use nflverse for weeks off our rosters, and carry the tag', () => {
  const P: Players = { '100': { name: 'A', pos: 'WR', team: 'CHI', injury: null } } as Players;
  const wk = (pts: Record<string, number>): Matchup[] => [{ roster_id: 1, matchup_id: 1, points: 0, starters: [], players: Object.keys(pts), players_points: pts } as unknown as Matchup];
  const weeks = [wk({}), wk({}), wk({ '100': 20 }), wk({ '100': 22 })];
  const nfl = { '100': player({ pts: [5, 6, 99, 99], games: 4, act: 13, exp: 8 }) };
  const [row] = trendRows([{ roster_id: 1, players: ['100'] }], P, weeks, [], {}, nfl);
  expect(row!.s26).toEqual([5, 6, 20, 22]);
  expect(row!.avg26).toBeCloseTo(13.25, 5);
  expect(row!.form).toBeCloseTo(21 - 5.5, 5);
  expect(row!.luck?.kind).toBe('sell');
  const [without] = trendRows([{ roster_id: 1, players: ['100'] }], P, weeks, [], {});
  expect(without!.s26).toEqual([null, null, 20, 22]);
  expect(without!.luck).toBeNull();
});
