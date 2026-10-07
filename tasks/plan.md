# Implementation Plan: Illini Fantasy Report

## Overview

This is a static Astro site for the Illini Fantasy Sleeper league (`1386106937921253376`). All Sleeper data is fetched at build time and turned into standings, what if, power ranking, and history pages. A weekly GitHub Action drafts a newspaper style recap with Claude and opens a PR for review. The site is hosted on Cloudflare Pages and rebuilt daily. See `SPEC.md` for the full requirements. Tasks with acceptance criteria are in `tasks/todo.md`.

## Architecture Decisions

- **One data module, memoized.** `src/lib/sleeper.ts` caches each request in a module level promise `Map`, so pages that need the same data share one fetch per build. The players DB (about 5 MB) gets cut down to `{id → name, pos, team}` on first load.
- **Only final weeks count.** Weeks `1..state.last_scored_leg` count as complete, and the week in progress is ignored. This comes from probing `/state/nfl` and the league `settings`.
- **Regular season and playoffs stay separate.** Weeks below `settings.playoff_week_start` (15) feed standings, what if, power rankings, and all time W/L. Playoff games only show up in brackets and the playoff appearance and title counts.
- **Champions come from brackets.** The winner of the `p: 1` match in `/winners_bracket` is the champion. This matches `metadata.latest_league_winner_roster_id = 6` for 2025.
- **The punishment loser comes from the regular season standings.** It's the last place team in `standings()`, so no extra logic is needed. `/losers_bracket` is never fetched.
- **Draft hits and busts use league scoring.** Each player's season points are summed from `players_points` across that season's matchups. That counts points scored while on any roster in this league, so free agent weeks are left out. This is good enough to judge draft value, and it avoids Sleeper's undocumented stats API.
- **Position points use the player's real position, not the lineup slot.** A WR in a FLEX slot counts as WR.
- **Pure stats code.** `src/lib/stats.ts` and `src/lib/history.ts` take plain data and return plain data. Tests run them against saved fixtures and never hit the network.
- **Deploy early.** Cloudflare Pages and the CSP headers go live in Phase 1. Hosting and header problems show up before there are many pages to debug.

## Task List

Details for each task are in `tasks/todo.md`.

### Phase 1: Foundation
- [x] T1: Scaffold Astro, Vitest, and CI
- [ ] T2: Base layout, UIUC theme, and light/dark toggle
- [ ] T3: Sleeper client and `/standings` page
- [ ] T4: Deploy to Cloudflare Pages with security headers and daily refresh

### Checkpoint A: Live skeleton
- [ ] A deployed URL shows the real standings, the theme toggle works, and CI is green

### Phase 2: League stats pages
- [ ] T5: What if matrix
- [ ] T6: Overall power rankings
- [ ] T7: Positional power rankings
- [ ] T8: Interesting facts on standings

### Checkpoint B: Stats complete
- [ ] All stats pages match the Sleeper app for the current week

### Phase 3: Weekly report (can run in parallel with Phase 4)
- [ ] T9: Newspaper report page, home page, and a sample report
- [ ] T10: Save PDF and Save image export
- [ ] T11: Report style linter
- [ ] T12: Report writer script (facts bundle, RSS, Claude)
- [ ] T13: Weekly report GitHub Action that opens a PR

### Checkpoint C: Report pipeline
- [ ] A manual workflow run opens a PR that passes the linter and reads well

### Phase 4: League history (can run in parallel with Phase 3)
- [ ] T14: History data layer (season chain, managers, champions)
- [ ] T15: `/history` overview page
- [ ] T16: `/history/{season}` with the draft board

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
| The model invents a stat | High | The prompt passes only the facts bundle and tells the model to use only those numbers. Human review is the final check |
| Theme flash breaks the strict CSP | Low | The inline theme script is allowed by its hash in `_headers`, and T4 verifies it with the browser console |
| The players DB fetch slows builds | Low | It's fetched once per build, memoized, and trimmed |
| Actions can't open PRs by default | Low | Enable "Allow GitHub Actions to create pull requests" in repo settings during T13 |

## Things You Need To Do (Claude can't)

- **T4:** Create a Cloudflare account, connect the repo in Pages, set `SLEEPER_LEAGUE_ID`, and create a deploy hook. Then add `CF_DEPLOY_HOOK_URL` as a GitHub secret.
- **T4:** Turn on GitHub secret scanning push protection.
- **T12/T13:** Create an Anthropic API key, set a monthly spend limit, and add `ANTHROPIC_API_KEY` as a GitHub secret.

## Open Questions

- None.
