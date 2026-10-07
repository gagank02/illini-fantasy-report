import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import type { League } from '../src/lib/sleeper';

// These tests must never reach FantasyCalc. Any fetch fails the test.
const fetchSpy = vi.fn(() => { throw new Error('tests must not call the network'); });
vi.stubGlobal('fetch', fetchSpy);
afterEach(() => { vi.resetModules(); expect(fetchSpy).not.toHaveBeenCalled(); });

const fc = () => import('../src/lib/fantasycalc');
const league = JSON.parse(readFileSync('tests/fixtures/league.json', 'utf8')) as League;

test('live values only on a production build that asks for them', async () => {
  const { valuesMode } = await fc();
  expect(valuesMode({})).toBe('off');
  expect(valuesMode({ FANTASYCALC: 'live' })).toBe('live');
  expect(valuesMode({ FANTASYCALC: 'live', CF_PAGES: '1', CF_PAGES_BRANCH: 'main' })).toBe('live');
  expect(valuesMode({ FANTASYCALC: 'live', CF_PAGES: '1', CF_PAGES_BRANCH: 'report/2026-week-5' })).toBe('off');
  expect(valuesMode({ FANTASYCALC: 'live', GITHUB_ACTIONS: 'true' })).toBe('off');
  expect(valuesMode({ FANTASYCALC: 'live', VITEST: 'true' })).toBe('off');
});

test('sample values never ship from Cloudflare', async () => {
  const { valuesMode } = await fc();
  expect(valuesMode({ FANTASYCALC: 'sample' })).toBe('sample');
  expect(valuesMode({ FANTASYCALC: 'sample', CF_PAGES: '1', CF_PAGES_BRANCH: 'main' })).toBe('off');
});

test('loadValues stays offline when off or sample', async () => {
  expect(await (await fc()).loadValues(league, {})).toBeNull();
  vi.resetModules();
  const sample = await (await fc()).loadValues(league, { FANTASYCALC: 'sample' });
  expect(sample!.length).toBeGreaterThan(100);
  vi.resetModules();
  // Even with FANTASYCALC=live, the test runner is refused.
  expect(await (await fc()).loadValues(league, { FANTASYCALC: 'live', VITEST: 'true' })).toBeNull();
});

test('query matches our league: redraft, 1 QB, 12 teams, PPR from scoring settings', async () => {
  const { queryFor, valuesUrl } = await fc();
  const q = queryFor({ ...league, scoring_settings: { rec: 0.5 } });
  expect(q).toEqual({ isDynasty: false, numQbs: '1', numTeams: 12, ppr: 0.5 });
  expect(valuesUrl(q)).toBe('https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5');
  expect(queryFor({ ...league, roster_positions: ['QB', 'SUPER_FLEX', 'RB'], total_rosters: 11 }).numQbs).toBe('2');
  expect(queryFor(league).ppr).toBe(1);
});

test('valueMap keys by Sleeper id and uses redraft value for redraft leagues', async () => {
  const { valueMap } = await fc();
  const m = valueMap([
    { player: { id: 1, name: 'A', position: 'WR', sleeperId: '10' }, value: 900, redraftValue: 800 },
    { player: { id: 2, name: 'B', position: 'RB', sleeperId: null }, value: 500, redraftValue: 500 },
  ], false);
  expect([...m]).toEqual([['10', { pos: 'WR', value: 800 }]]);
});
