import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { checkCoverage, keepRostered, loadTrades, mayFetch, queryFor, readSaved, SAVED_PATH, sampleValues, serializeTrades, tradesAvailable, valuesUrl, type SavedTrades } from '../src/lib/fantasycalc';
import { tradeBoard, valuedRosters } from '../src/lib/trades';
import type { Roster } from '../src/lib/sleeper';
import type { Players } from '../src/lib/stats';
import type { League } from '../src/lib/sleeper';

// These tests must never reach FantasyCalc. Any fetch throws.
vi.stubGlobal('fetch', () => { throw new Error('tests must not call the network'); });

const league = JSON.parse(readFileSync('tests/fixtures/league.json', 'utf8')) as League;
const saved = (fetched: string): SavedTrades => ({ fetched, query: queryFor(league), board: { pairs: {}, byTeam: {} } });
const rosters = JSON.parse(readFileSync('tests/fixtures/rosters.json', 'utf8')) as Roster[];

test('the update script fetches only for the daily job, once per UTC day', () => {
  expect(mayFetch({}, null, '2026-10-08')).toBe(false);
  expect(mayFetch({ FANTASYCALC: 'live' }, null, '2026-10-08')).toBe(true);
  expect(mayFetch({ FANTASYCALC: 'live' }, saved('2026-10-07'), '2026-10-08')).toBe(true);
  // A rerun on the same day adds no call.
  expect(mayFetch({ FANTASYCALC: 'live' }, saved('2026-10-08'), '2026-10-08')).toBe(false);
  expect(mayFetch({ FANTASYCALC: 'live', VITEST: 'true' }, null, '2026-10-08')).toBe(false);
});

test('builds read saved trades from disk; sample trades never ship from Cloudflare', () => {
  const sample = loadTrades({ FANTASYCALC: 'sample' }, rosters, league.roster_positions);
  expect(sample!.sample).toBe(true);
  expect(Object.keys(sample!.saved.board.byTeam)).toHaveLength(12);
  expect(loadTrades({ FANTASYCALC: 'sample', CF_PAGES: '1' }, rosters, league.roster_positions, 'tests/fixtures/does-not-exist.json')).toBeNull();
  expect(tradesAvailable({ FANTASYCALC: 'sample' }, 'tests/fixtures/does-not-exist.json')).toBe(true);
  expect(tradesAvailable({ FANTASYCALC: 'sample', CF_PAGES: '1' }, 'tests/fixtures/does-not-exist.json')).toBe(false);
  expect(readSaved('tests/fixtures/does-not-exist.json')).toBeNull();
});

test('the committed file holds trade suggestions only, never FantasyCalc values', () => {
  expect(SAVED_PATH).toBe('src/data/trades.json');
  const board = tradeBoard(valuedRosters(rosters, new Map(Object.entries(sampleValues()))), league.roster_positions);
  const text = serializeTrades('2026-10-08', queryFor(league), board);
  const parsed = JSON.parse(text) as SavedTrades;
  expect(parsed.fetched).toBe('2026-10-08');
  expect(Object.keys(parsed.board.byTeam).length).toBe(12);
  // No raw values anywhere: no value fields, and no number that equals a player's value.
  expect(text).not.toMatch(/"(value|values|redraftValue|aGetsValue|bGetsValue)"/);
  const valueSet = new Set(Object.values(sampleValues()).map(v => v.value));
  const numbers = [...text.matchAll(/-?\d+(\.\d+)?/g)].map(m => Number(m[0]));
  expect(numbers.filter(n => n > 100 && valueSet.has(n))).toEqual([]);
  for (const t of Object.values(parsed.board.byTeam).flat()) expect(t.valueGap).toBeGreaterThanOrEqual(0);
});

test('query matches our league: redraft, 1 QB, 12 teams, PPR from scoring settings', () => {
  const q = queryFor({ ...league, scoring_settings: { rec: 0.5 } });
  expect(q).toEqual({ isDynasty: false, numQbs: '1', numTeams: 12, ppr: 0.5 });
  expect(valuesUrl(q)).toBe('https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5');
  expect(queryFor({ ...league, roster_positions: ['QB', 'SUPER_FLEX', 'RB'], total_rosters: 11 }).numQbs).toBe('2');
  expect(queryFor(league).ppr).toBe(1);
});

test('only rostered players are kept, with redraft values for redraft leagues', () => {
  const kept = keepRostered([
    { player: { id: 1, name: 'A', position: 'WR', sleeperId: '10' }, value: 900, redraftValue: 800 },
    { player: { id: 2, name: 'B', position: 'RB', sleeperId: '11' }, value: 500, redraftValue: 500 },
    { player: { id: 3, name: 'C', position: 'TE', sleeperId: null }, value: 500, redraftValue: 500 },
  ], new Set(['10']), false);
  expect(kept).toEqual({ '10': { pos: 'WR', value: 800 } });
});

test('values that are not positive finite numbers are dropped', () => {
  const kept = keepRostered([
    { player: { id: 1, name: 'A', position: 'WR', sleeperId: '10' }, value: Number.NaN, redraftValue: Number.NaN },
    { player: { id: 2, name: 'B', position: 'RB', sleeperId: '11' }, value: 0, redraftValue: 0 },
    { player: { id: 3, name: 'C', position: 'QB', sleeperId: '12' }, value: 5, redraftValue: 5 },
  ], new Set(['10', '11', '12']), false);
  expect(Object.keys(kept)).toEqual(['12']);
});

describe('checkCoverage (runs before a fresh value list is saved)', () => {
  const players: Players = {
    q: { name: 'Q One', pos: 'QB', team: 'A', injury: null },
    r: { name: 'R One', pos: 'RB', team: 'A', injury: null },
    w: { name: 'W One', pos: 'WR', team: 'A', injury: null },
    t: { name: 'T One', pos: 'TE', team: 'A', injury: null },
    k: { name: 'Kicker', pos: 'K', team: 'A', injury: null },
  };
  const rostered = ['q', 'r', 'w', 't', 'k'];

  test('counts only QB, RB, WR, TE; names the missing ones and position mismatches', () => {
    const c = checkCoverage({ q: { pos: 'QB', value: 1 }, r: { pos: 'WR', value: 1 }, w: { pos: 'WR', value: 1 } }, rostered, players);
    expect(c).toMatchObject({ skill: 4, valued: 3, missing: ['T One'], posMismatch: ['R One (FantasyCalc WR, Sleeper RB)'], ok: true });
  });
  test('an empty or mostly empty list is not ok, so yesterday\'s file stays', () => {
    expect(checkCoverage({}, rostered, players).ok).toBe(false);
    expect(checkCoverage({ q: { pos: 'QB', value: 1 } }, rostered, players).ok).toBe(false);
  });
});
