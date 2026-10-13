// GitHub drops scheduled workflow runs under load, with no retry and no error. This Cloudflare Worker runs
// 30 minutes after each GitHub cron and starts the workflow itself if GitHub never did. If GitHub's run is
// already there (any event, any status), it does nothing, so a normal day still runs once.

export interface Env {
  /** owner/name */
  GITHUB_REPO: string;
  /** Fine grained token, this repo only, Actions: read and write. */
  GITHUB_TOKEN: string;
}

export interface Job {
  /** Cloudflare cron that runs this check (wrangler.jsonc). */
  cron: string;
  workflow: string;
  /** UTC hour of the GitHub cron this backs up. Runs created since then today count as "already ran". */
  sinceHourUtc: number;
}

export const JOBS: Job[] = [
  { cron: '47 10 * * *', workflow: 'refresh.yml', sinceHourUtc: 10 },
  { cron: '53 15 * * tue', workflow: 'weekly-report.yml', sinceHourUtc: 15 },
];

const API = 'https://api.github.com';

function headers(env: Env): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'illini-refresh-cron',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Starts `job.workflow` on main unless a run of it was created since its GitHub cron hour today. */
export async function backup(job: Job, now: Date, env: Env): Promise<'already ran' | 'dispatched'> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), job.sinceHourUtc));
  const base = `${API}/repos/${env.GITHUB_REPO}/actions/workflows/${job.workflow}`;

  const runs = await fetch(`${base}/runs?per_page=1&created=${encodeURIComponent('>=' + since.toISOString())}`, { headers: headers(env) });
  if (!runs.ok) throw new Error(`Listing ${job.workflow} runs returned ${runs.status}`);
  if (((await runs.json()) as { total_count: number }).total_count > 0) return 'already ran';

  const res = await fetch(`${base}/dispatches`, { method: 'POST', headers: headers(env), body: JSON.stringify({ ref: 'main' }) });
  if (!res.ok) throw new Error(`Dispatching ${job.workflow} returned ${res.status}`);
  return 'dispatched';
}

export default {
  async scheduled(event: { cron: string; scheduledTime: number }, env: Env): Promise<void> {
    // Match on the fire time, not the cron text: Cloudflare may hand back the expression in another form
    // (e.g. "TUE" or a day number), and an exact string match then silently skips the job.
    const at = new Date(event.scheduledTime);
    const job = JOBS.find(j => {
      const [min, hour] = j.cron.split(' ').map(Number);
      return hour === at.getUTCHours() && min === at.getUTCMinutes();
    });
    if (!job) throw new Error(`No job for cron ${event.cron} at ${at.toISOString()}`);
    console.log(`${job.workflow}: ${await backup(job, new Date(event.scheduledTime), env)}`);
  },
};
