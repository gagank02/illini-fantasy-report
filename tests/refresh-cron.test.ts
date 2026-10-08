import { afterEach, expect, test, vi } from 'vitest';
import worker, { backup, JOBS } from '../workers/refresh-cron/index.ts';

const env = { GITHUB_REPO: 'gagank02/illini-fantasy-report', GITHUB_TOKEN: 'test-token' };
const refresh = JOBS.find(j => j.workflow === 'refresh.yml')!;

function mockGitHub(totalCount: number) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/runs?')) return new Response(JSON.stringify({ total_count: totalCount }));
    return new Response(null, { status: 204 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

test('does nothing when GitHub already ran the workflow today', async () => {
  const calls = mockGitHub(1);
  expect(await backup(refresh, new Date('2026-10-08T10:47:00Z'), env)).toBe('already ran');
  expect(calls).toHaveLength(1);
  expect(decodeURIComponent(calls[0]!.url)).toContain('/actions/workflows/refresh.yml/runs?per_page=1&created=>=2026-10-08T10:00:00.000Z');
});

test('dispatches on main when GitHub dropped the run', async () => {
  const calls = mockGitHub(0);
  expect(await backup(refresh, new Date('2026-10-08T10:47:00Z'), env)).toBe('dispatched');
  expect(calls[1]!.url).toBe('https://api.github.com/repos/gagank02/illini-fantasy-report/actions/workflows/refresh.yml/dispatches');
  expect(calls[1]!.init?.method).toBe('POST');
  expect(JSON.parse(calls[1]!.init?.body as string)).toEqual({ ref: 'main' });
});

test('fails loudly when GitHub rejects the token', async () => {
  vi.stubGlobal('fetch', async () => new Response('Bad credentials', { status: 401 }));
  await expect(backup(refresh, new Date('2026-10-08T10:47:00Z'), env)).rejects.toThrow('401');
});

test('wrangler.jsonc crons match JOBS, and each check runs after the GitHub cron it backs up', async () => {
  const { readFileSync } = await import('node:fs');
  const config = readFileSync('workers/refresh-cron/wrangler.jsonc', 'utf8');
  const crons = JSON.parse(config.match(/"crons":\s*(\[[^\]]*\])/)![1]!);
  expect(crons).toEqual(JOBS.map(j => j.cron));
  for (const job of JOBS) {
    const github = readFileSync(`.github/workflows/${job.workflow}`, 'utf8').match(/cron: '(\d+) (\d+) ([^']*)'/)!;
    const [min, hour, ...days] = job.cron.split(' ');
    const rest = days.join(' ');
    expect(Number(github[2]), job.workflow).toBe(job.sinceHourUtc);
    expect(Number(hour) * 60 + Number(min), job.workflow).toBeGreaterThan(Number(github[2]) * 60 + Number(github[1]));
    expect(rest, job.workflow).toBe(github[3]);
  }
});

test('the scheduled handler picks the job by cron', async () => {
  mockGitHub(1);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await worker.scheduled({ cron: '47 10 * * *', scheduledTime: Date.parse('2026-10-08T10:47:00Z') }, env);
  expect(log).toHaveBeenCalledWith('refresh.yml: already ran');
});
