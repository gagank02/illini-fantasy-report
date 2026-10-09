import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createLimiter } from '../src/lib/sleeper';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A fresh sleeper module (empty memory cache) reading and writing `dir`, with fetch stubbed. */
async function freshSleeper(dir: string, status: string) {
  vi.stubEnv('SLEEPER_CACHE_DIR', dir);
  const fetch = vi.fn(async (url: string) => {
    const body = url.endsWith('/league/1') ? { league_id: '1', draft_id: '9', status } : [{ url }];
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetch);
  vi.resetModules();
  return { fetch, sleeper: await import('../src/lib/sleeper') };
}

async function loadAll(sleeper: typeof import('../src/lib/sleeper')) {
  await sleeper.leagueById('1');
  await Promise.all([sleeper.leagueUsers('1'), sleeper.weekMatchups(1, '1'), sleeper.winnersBracket('1'), sleeper.draftPicks('9')]);
}

test('a completed league is fetched once, then read from disk by later builds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sleeper-'));
  const first = await freshSleeper(dir, 'complete');
  await loadAll(first.sleeper);
  expect(first.fetch).toHaveBeenCalledTimes(5);
  expect(readdirSync(dir)).toHaveLength(5);

  const second = await freshSleeper(dir, 'complete');
  await loadAll(second.sleeper);
  expect(second.fetch).not.toHaveBeenCalled();
  expect(second.sleeper.calls).toEqual({ live: 0, cached: 5 });
});

test('an in progress league is never written to disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sleeper-'));
  for (let i = 0; i < 2; i++) {
    const { fetch, sleeper } = await freshSleeper(dir, 'in_season');
    await loadAll(sleeper);
    expect(fetch).toHaveBeenCalledTimes(5);
  }
  expect(readdirSync(dir)).toHaveLength(0);
});

test('a half written file is fetched again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sleeper-'));
  writeFileSync(join(dir, 'league_1.json'), '{"league_id":');
  const { fetch, sleeper } = await freshSleeper(dir, 'complete');
  expect((await sleeper.leagueById('1')).status).toBe('complete');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('allows up to max calls per window, then waits for the oldest to expire', async () => {
  vi.useFakeTimers();
  const limit = createLimiter(2, 60_000);
  const done: number[] = [];
  for (const i of [1, 2, 3]) void limit().then(() => done.push(i));
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toEqual([1, 2]);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(done).toEqual([1, 2]);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toEqual([1, 2, 3]);
});
