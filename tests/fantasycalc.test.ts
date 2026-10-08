import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { buildValues, keepRostered, mayFetch, queryFor, readSaved, valuesUrl, type SavedValues } from '../src/lib/fantasycalc';
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
