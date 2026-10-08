import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { buildValues, checkCoverage, keepRostered, mayFetch, queryFor, readSaved, valuesUrl, type SavedValues } from '../src/lib/fantasycalc';
import type { Players } from '../src/lib/stats';
import type { League } from '../src/lib/sleeper';

// These tests must never reach FantasyCalc. Any fetch throws.
vi.stubGlobal('fetch', () => { throw new Error('tests must not call the network'); });

const league = JSON.parse(readFileSync('tests/fixtures/league.json', 'utf8')) as League;
const saved = (fetched: string): SavedValues => ({ fetched, query: queryFor(league), values: {} });

test('the update script fetches only for the daily job, once per UTC day', () => {
  expect(mayFetch({}, null, '2026-10-08')).toBe(false);
  expect(mayFetch({ FANTASYCALC: 'live' }, null, '2026-10-08')).toBe(true);
  expect(mayFetch({ FANTASYCALC: 'live' }, saved('2026-10-07'), '2026-10-08')).toBe(true);
  // A rerun on the same day adds no call.
  expect(mayFetch({ FANTASYCALC: 'live' }, saved('2026-10-08'), '2026-10-08')).toBe(false);
  expect(mayFetch({ FANTASYCALC: 'live', VITEST: 'true' }, null, '2026-10-08')).toBe(false);
});

test('builds read values from disk; sample values never ship from Cloudflare', () => {
  const sample = buildValues({ FANTASYCALC: 'sample' });
  expect(sample!.sample).toBe(true);
  expect(Object.keys(sample!.saved.values).length).toBeGreaterThan(100);
  // On Cloudflare the sample is ignored: a build gets the saved file's values, or null before the daily job saves one.
  expect(buildValues({ FANTASYCALC: 'sample', CF_PAGES: '1' })?.sample ?? false).toBe(false);
  // Passes whether or not the daily job has committed src/data/trade-values.json yet.
  expect(readSaved('tests/fixtures/does-not-exist.json')).toBeNull();
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
