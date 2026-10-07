# Implementation Plan: Illini Fantasy Report

## Overview

This is a static Astro site for the Illini Fantasy Sleeper league (`1386106937921253376`). All Sleeper data is fetched at build time and turned into standings, what if, power ranking, and history pages. A weekly GitHub Action drafts a newspaper style recap with Claude and opens a PR for review. The site is hosted on Cloudflare Pages and rebuilt daily. See `SPEC.md` for the full requirements. Tasks with acceptance criteria are in `tasks/todo.md`.

## Architecture Decisions

- **One data module, memoized.** `src/lib/sleeper.ts` caches each request in a module level promise `Map`, so pages that need the same data share one fetch per build. A sliding window limiter caps each process at 600 calls a minute (Sleeper may block above 1000). It's tested, and it only matters if a bug causes a call loop.
- **Only final weeks count.** Weeks `1..state.last_scored_leg` count as complete, and the week in progress is ignored. This comes from probing `/state/nfl` and the league `settings`.
- **Regular season and playoffs stay separate.** Weeks below `settings.playoff_week_start` (15) feed standings, what if, power rankings, and all time W/L. Playoff games only show up in brackets and the playoff appearance and title counts.
- **Champions come from brackets.** The winner of the `p: 1` match in `/winners_bracket` is the champion. This matches `metadata.latest_league_winner_roster_id = 6` for 2025.
- **The punishment loser comes from the regular season standings.** It's the last place team in `standings()`, so no extra logic is needed. `/losers_bracket` is never fetched.
- **Players list comes from a committed file.** Sleeper asks that `/players/nfl` (about 5 MB) be called at most once a day. Builds can run several times a day (daily refresh, pushes, PR previews), so builds never call it. `scripts/update-players.ts` writes a trimmed `src/data/players.json` (fantasy positions only, about 400 KB, never shipped to the browser). It runs once in T7 to create the file, then weekly inside the report Action, which also gets fresh injury statuses that way.
- **Sleeper call budget per build:** about 20 calls for the current season, about 23 per past season, and about 25 for the report script. That's about 100 today and about 300 after 10 seasons, far under 1000 a minute.
- **Draft hits and busts use league scoring.** Each player's season points are summed from `players_points` across that season's matchups. That counts points scored while on any roster in this league, so free agent weeks are left out. This is good enough to judge draft value, and it avoids Sleeper's undocumented stats API.
- **Position points use the player's real position, not the lineup slot.** A WR in a FLEX slot counts as WR.
- **Pure stats code.** `src/lib/stats.ts` and `src/lib/history.ts` take plain data and return plain data. Tests run them against saved fixtures and never hit the network.
- **Deploy early.** Cloudflare Pages and the CSP headers go live in Phase 1. Hosting and header problems show up before there are many pages to debug.

## Task List

Details for each task are in `tasks/todo.md`.

### Phase 1: Foundation
- [x] T1: Scaffold Astro, Vitest, and CI
- [x] T2: Base layout, UIUC theme, and light/dark toggle
- [x] T3: Sleeper client and `/standings` page
- [x] T4: Deploy to Cloudflare Pages with security headers and daily refresh

### Checkpoint A: Live skeleton
- [x] A deployed URL shows the real standings, the theme toggle works, and CI is green

### Phase 2: League stats pages
- [x] T5: What if matrix
- [x] T6: Overall power rankings
- [x] T7: Positional power rankings
- [x] T8: Interesting facts (moved to the home page)
- [x] T8b: Home page previews for each tab

### Checkpoint B: Stats complete
- [ ] All stats pages match the Sleeper app for the current week

### Phase 3: Weekly report (can run in parallel with Phase 4)
- [x] T9: Newspaper report page, home page, and a sample report
- [x] T10: Save PDF and Save image export
- [x] T11: Report style linter
- [x] T12a: Report facts bundle (bench blunders, transactions, injuries, movers, next week)
- [x] T12b: Report writer script (RSS, Claude, lint retry)
- [x] T13: Weekly report GitHub Action that opens a PR

### Checkpoint C: Report pipeline
- [x] A manual workflow run opens a PR that passes the linter and reads well

### Phase 4: League history (can run in parallel with Phase 3)
- [x] T14: History data layer (season chain, managers, champions)
- [x] T15: `/history` overview page
- [x] T16: `/history/{season}` with the draft board

### Checkpoint D: Done
- [ ] Every success criterion in `SPEC.md` passes

## Parallelization

T1 through T8 must run in order because they share `sleeper.ts`, `stats.ts`, and the layout. After Checkpoint B, Phase 3 and Phase 4 touch different files, so two sessions can work on them at once. The only shared file is the nav in `Base.astro`, so add both nav links in T2.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Season sizes differ (10 teams in 2024, 12 since) | Med | Fixtures cover both sizes, and the all time sums are tested |
| ESPN RSS changes or goes down | Low | The writer catches fetch errors and continues with Sleeper data only |
| Claude ignores the style rules | Med | T11's linter blocks the PR. The prompt includes the banned list, and you review before merge |
| The weekly run hits your subscription's usage limit | Low | One report a week is small. If it fails, rerun the workflow later |
| The model invents a stat | High | The prompt passes only the facts bundle and tells the model to use only those numbers. Human review is the final check |
| Theme flash breaks the strict CSP | Low | The inline theme script is allowed by its hash in `_headers`, and T4 verifies it with the browser console |
| A bug causes a call loop and Sleeper IP blocks us | Med | A rate limiter in `get()` (600 a minute), per URL memoization, and a guard on repeated IDs in the history walk |
| Builds call `/players/nfl` too often | Med | Builds read the committed `src/data/players.json`. Only the weekly Action calls the endpoint |
| Actions can't open PRs by default | Low | Enable "Allow GitHub Actions to create pull requests" in repo settings during T13 |
| `ci.yml` doesn't run on PRs opened by an Action's built in token | Med | The weekly job runs test, check, build, secret guard, and lint itself before opening the PR (T13) |
| GitHub turns off cron workflows after 60 days with no activity | Low | Weekly merges keep the repo active during the season. Re enable at the start of the season if needed |

## Things You Need To Do (Claude can't)

- **T4:** Create a Cloudflare account, connect the repo in Pages, set `SLEEPER_LEAGUE_ID`, and create a deploy hook. Then add `CF_DEPLOY_HOOK_URL` as a GitHub secret.
- **T4:** Turn on GitHub secret scanning push protection.
- **T13:** Run `claude setup-token` locally and add the result as the GitHub secret `CLAUDE_CODE_OAUTH_TOKEN`. Reports use your Claude subscription, not a paid API key.
- **T13:** Under GitHub → Settings → Actions → General, turn on "Allow GitHub Actions to create and approve pull requests". If you add branch protection to `main`, don't make `ci.yml` a required check, because it won't run on the report PRs.

## Open Questions

- None.
