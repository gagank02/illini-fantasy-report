# Refresh cron (Cloudflare Worker)

GitHub's `schedule:` trigger is best effort: under load it drops runs with no retry and no error, and it
dropped the daily refresh on both of its first two days. This Worker is the backup. Cloudflare's Cron
Triggers don't have that problem. 30 minutes after each GitHub cron the Worker checks whether the workflow ran
and starts it if it didn't.

| Workflow            | GitHub cron (UTC) | Worker check (UTC) |
| ------------------- | ----------------- | ------------------ |
| `refresh.yml`       | daily 10:17       | daily 10:47        |
| `weekly-report.yml` | Tuesday 15:23     | Tuesday 15:53      |

Each day gets exactly one real run. If GitHub's run started, the Worker does nothing. If the Worker
started one and GitHub's scheduled run shows up late anyway, that run's first job (`guard`) sees the
earlier run and stops before calling Sleeper, FantasyCalc, or Claude.

## One time setup

1. On GitHub, create a fine grained personal access token (Settings → Developer settings → Fine-grained
   tokens). Give it access to **only** `gagank02/illini-fantasy-report` with **Actions: Read and write**.
   No other permissions are needed.
2. From this folder, sign in to Cloudflare and deploy:
   ```sh
   cd workers/refresh-cron
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN   # paste the token
   ```
3. To check it, open the Worker in the Cloudflare dashboard → Settings → Trigger Events, or run
   `npx wrangler tail` around 10:47 UTC. Each check logs `refresh.yml: already ran` or `refresh.yml: dispatched`.

When the token expires, make a new one and run `npx wrangler secret put GITHUB_TOKEN` again. If you
change a GitHub cron, update `JOBS` in `index.ts` and `triggers.crons` in `wrangler.jsonc` to match.
