# Tasks: Illini Fantasy Report

Each task needs `npm test && npm run check && npm run build` to pass before it counts as done. See `tasks/plan.md` for context.

## Phase 1: Foundation

## Task 1: Scaffold Astro, Vitest, and CI

**Description:** Create the empty project. Astro 7 builds to static output with strict TypeScript. Vitest runs the tests. `.env.example` holds placeholders. A CI workflow runs test, check, build, audit, and the secret guard on every PR.

**Acceptance criteria:**
- [x] `npm run dev` serves a blank page, and the `build`, `test`, and `check` scripts exist and pass
- [x] `.env.example` lists `SLEEPER_LEAGUE_ID`, `ANTHROPIC_API_KEY`, and `CF_DEPLOY_HOOK_URL` with placeholder values
- [x] `ci.yml` runs on PRs and pushes to `main`. It fails if `dist/` contains `sk-ant-` or `pages/webhooks/deploy_hooks`

**Verification:**
- [x] `npm ci && npm test && npm run check && npm run build`
- [x] Manual: put `sk-ant-test` into a page, confirm the guard step fails, then revert

**Dependencies:** None

**Files likely touched:** `package.json`, `astro.config.mjs`, `tsconfig.json`, `.env.example`, `.github/workflows/ci.yml`

**Estimated scope:** M

## Task 2: Base layout, UIUC theme, and light/dark toggle

**Description:** Build the shared layout with the nav (Home, Reports, Standings, Power Rankings, What If, History) and a footer. Add `global.css` with color tokens for light and dark. Add the theme toggle. A tiny inline script in `<head>` applies the saved theme before the page paints, so there's no flash. On mobile the nav collapses into a `<details>` menu, which needs no JS.

**Acceptance criteria:**
- [x] The page follows the OS theme by default. The toggle overrides it, and the choice survives a reload with no flash
- [x] Orange text on the dark background meets WCAG AA (4.5:1). Use a lighter orange in dark mode if needed
- [x] No horizontal page scroll at 360px, and the nav works with the keyboard

**Verification:**
- [x] Build succeeds
- [x] Manual: toggle the theme, reload, and switch the OS theme in DevTools at 360px and desktop widths

**Dependencies:** T1

**Files likely touched:** `src/layouts/Base.astro`, `src/styles/global.css`, `src/pages/index.astro`

**Estimated scope:** S

## Task 3: Sleeper client and `/standings` page

**Description:** Write typed, memoized fetchers for the league, users, rosters, matchups for each week, and NFL state. Save fixtures from the real league, covering weeks 1 to 4 of 2026. Write `standings()` and `streak()` in `stats.ts` with tests. Render the `/standings` table.

**Acceptance criteria:**
- [x] The table shows rank, team, manager, W/L/T, PF, PA, and streak, sorted by wins then PF
- [x] Only weeks `1..last_scored_leg` count
- [x] The values match the Sleeper app

**Verification:**
- [x] `npm test`: standings sort order, ties, and streak, all against fixtures
- [x] Manual: compare `/standings` with the Sleeper app

**Dependencies:** T2

**Files likely touched:** `src/lib/sleeper.ts`, `src/lib/stats.ts`, `tests/fixtures/*.json`, `tests/stats.test.ts`, `src/pages/standings.astro`

**Estimated scope:** M

## Task 4: Deploy to Cloudflare Pages with security headers and daily refresh

**Description:** Add `public/_headers` with a strict CSP that allows the inline theme script by its hash, plus `nosniff`, `Referrer-Policy`, and `frame-ancestors 'none'`. Add `refresh.yml`, which runs daily at 10:00 UTC and POSTs to `CF_DEPLOY_HOOK_URL`. **You** do the Cloudflare and GitHub setup listed in `plan.md`.

**Done locally (verified with `wrangler pages dev` and headless Chrome):** `_headers` is served on every path. The hashed inline script and the external scripts run with no CSP violations. `/standings` is served with no redirect (`build.format: 'file'`). `tests/headers.test.ts` fails if the theme script changes without its hash.

**Acceptance criteria:**
- [x] The site is live at https://illini-fantasy-report.pages.dev, and the browser console shows no CSP errors
- [x] securityheaders.com grades the site A or better. securityheaders.com blocks automated scans, so Mozilla HTTP Observatory was used instead and graded it **A+** (130/100, 12 of 12 tests passed, 2026-10-07)
- [x] A manual `workflow_dispatch` of `refresh.yml` triggers a new deploy

**Verification:**
- [x] Manual: open the live URL, check the console, and run securityheaders.com
- [x] Manual: run the refresh workflow and watch the Pages deploy log

**Dependencies:** T3

**Files likely touched:** `public/_headers`, `.github/workflows/refresh.yml`

**Estimated scope:** S

## Checkpoint A: Live skeleton
- [x] All tests pass, and the build is clean
- [x] The live URL shows the real standings, and the theme toggle works there
- [x] Review with the human before going on

## Phase 2: League stats pages

## Task 5: What if matrix

**Description:** Add `recordWithSchedule(weeks, a, b)` and `whatIfMatrix()`. Render a 12×12 grid with the diagonal highlighted (48rem and up). Phones get an expandable `<details>` list per team instead, so nothing scrolls sideways.

**Acceptance criteria:**
- [x] The diagonal equals each team's actual record
- [x] When B's opponent was A, the cell compares A's score to B's score
- [x] At 320px and 360px the list view shows, and nothing scrolls sideways. At 768px and up the grid fits

**Verification:**
- [x] `npm test`: diagonal, the swap rule, and ties
- [x] Manual: check the page at 360px

**Dependencies:** T3

**Files likely touched:** `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/what-if.astro`

**Estimated scope:** S

## Task 6: Overall power rankings

**Description:** Add `allPlay()` and `powerRankings(weeks, upToWeek)` using the 50/30/20 formula, with min/max normalization. Compute the rankings through the last week and the week before it to get the ▲/▼ movement.

**Acceptance criteria:**
- [x] The scores follow the formula in the spec
- [x] The movement arrows reflect the rank change from last week, with no arrow in week 1
- [x] The page lists rank, team, score, all play record, and movement

**Verification:**
- [x] `npm test`: all play math against fixtures, plus ordering
- [x] Manual: spot check one team's all play record by hand

**Dependencies:** T3

**Files likely touched:** `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/power-rankings.astro`

**Estimated scope:** S

## Task 7: Positional power rankings

**Description:** Add `scripts/update-players.ts` (`npm run players`). It calls `/players/nfl` **once** and writes `src/data/players.json`, trimmed to id → name, position, NFL team, and injury status, for fantasy positions only. Run it once and commit the file. Pages import the JSON, so builds never call the endpoint. Add `positionPoints()`, which sums `starters_points` by each player's real position. Add QB, RB, WR, TE, K, and DEF tabs to `/power-rankings`. The tabs use radio inputs and CSS, so they need no JS.

**Acceptance criteria:**
- [x] No build or page calls `/players/nfl`. A grep for `players/nfl` finds it only in `scripts/update-players.ts`
- [x] A FLEX WR counts toward WR
- [x] Each tab ranks all 12 teams by season starter points at that position
- [x] The tabs work with the keyboard

**Verification:**
- [x] `npm test`: position sums against fixtures, including a FLEX case
- [x] Manual: switch tabs on mobile and desktop

**Dependencies:** T6

**Files likely touched:** `scripts/update-players.ts`, `src/data/players.json`, `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/power-rankings.astro`

**Estimated scope:** M

## Task 8: Interesting facts on standings

**Description:** `facts()` returns 3 to 5 facts: the highest single week score, the most points against, the biggest blowout, the longest current win streak, and the closest game. ~~Show them in a block on `/standings`.~~ Moved to the home page (see T8b).

**Acceptance criteria:**
- [x] Each fact names the team, the week, and the number
- [x] The block skips facts that aren't defined yet, for example a streak in week 1

**Verification:**
- [x] `npm test`: each fact against fixtures

**Dependencies:** T3

**Files likely touched:** `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/standings.astro`

**Estimated scope:** S

## Task 8b: Home page previews (added after T8 review)

**Description:** The home page has a preview card for each tab (Standings, Power Rankings, What If), each linking to the full page, plus "Around the league." History is excluded. `scheduleLuck()` powers the What If card.

**Acceptance criteria:**
- [x] The cards show the standings top 3, the power top 3 with movement and the biggest riser, and the luckiest and unluckiest schedules
- [x] "Around the league" lives on the home page and is gone from `/standings`
- [x] No horizontal scroll at 360px

**Verification:**
- [x] `npm test`: scheduleLuck equals actual minus average wins, sorted luckiest first
- [x] Manual: screenshots at 360px and 1280px

**Dependencies:** T5, T6, T8

## Checkpoint B: Stats complete
- [ ] All tests pass, and the build is clean
- [ ] Standings, what if, and power rankings match the Sleeper app for the current week
- [ ] Review with the human before going on

## Phase 3: Weekly report

## Task 9: Newspaper report page, home page, and a sample report

**Description:** Set up a content collection for `src/content/reports/{season}/week-{n}.md`, with frontmatter for `headline`, `lede`, `week`, `season`, and `date`. Build `ReportLayout.astro` with:
- the masthead in a self hosted blackletter woff2
- a dateline (Vol. = season, No. = week)
- a drop cap on the lede
- 3, 2, or 1 columns depending on screen width
- section rules
- a box score sidebar built from the matchups

Add the `/reports` index and the report pages. Add the latest report's headline and lede, linking to it, above the preview cards on the home page (cards came in T8b). Write one sample report by hand for week 4. Raw HTML in the markdown must not render.

**Acceptance criteria:**
- [x] The report reads as a newspaper in light and dark mode, at 360px and on desktop
- [x] HTML put into the sample report shows up escaped, or not at all
- [x] The home page links to the latest report

**Verification:**
- [x] Build succeeds
- [x] Manual: look at the page at three widths in both themes

**Dependencies:** T3 (scores for the box score)

**Licensing:** Get UnifrakturMaguntia from its official source (Google Fonts or the upstream repo). Check that its license is OFL 1.1, and commit `public/fonts/OFL.txt` with the font. Use no other images except our own SVG.

**Files likely touched:** `public/fonts/OFL.txt`, `src/content.config.ts`, `src/layouts/ReportLayout.astro`, `src/pages/reports/[...slug].astro`, `src/pages/reports/index.astro`, `src/pages/index.astro`, `public/fonts/*.woff2`, `src/content/reports/2026/week-4.md`

**Estimated scope:** M (7 files, but most are small)

## Task 10: Save PDF and Save image export

**Description:** A print stylesheet hides the nav and buttons, forces light colors, sets `@page { size: letter }`, and avoids column breaks inside paragraphs. "Save PDF" calls `window.print()`. "Save image" dynamically imports `html-to-image`, renders the article at a fixed 1080px width, and downloads `illini-report-{season}-week-{n}.png`. Adding `html-to-image` is already approved in the spec.

**Acceptance criteria:**
- [x] The printed PDF is 1 to 2 letter pages with no nav or buttons (Chrome verified: 1 page, light colors from a dark mode browser). Safari is still for the human to check
- [x] The PNG is 1080px wide and includes the masthead font (verified at 1440px and 360px viewports under the production CSP; identical 1080x1169 output)
- [x] The page's on load JS stays under 5 KB (2.7 KB), because `html-to-image` (12.5 KB) loads only when clicked

**Verification:**
- [ ] Manual (human): export both formats in desktop Safari and on an iPhone. Desktop Chrome done
- [x] Manual: the DevTools network tab shows no `html-to-image` request until the button is clicked

**Dependencies:** T9

**Files likely touched:** `package.json`, `src/layouts/ReportLayout.astro`, `src/styles/print.css`

**Estimated scope:** S

## Task 11: Report style linter

**Description:** `scripts/lint-report.ts <file>` exits 1 and lists each violation with its line number. It flags:
- dashes (hyphen, en, em), except inside player names from the trimmed Sleeper player list
- semicolons
- colons, except in frontmatter
- emojis
- `*`
- hashtags
- raw HTML tags
- the banned phrases from `writing-style.md`

**Acceptance criteria:**
- [x] Each banned pattern has a failing test case
- [x] "Amon-Ra St. Brown" passes, and "game-changer" fails
- [x] Frontmatter is skipped

**Verification:**
- [x] `npm test`: `tests/lint-report.test.ts`
- [x] `npm run lint:report -- src/content/reports/2026/week-4.md` passes on the sample

**Dependencies:** T7 (players list)

**Files likely touched:** `scripts/lint-report.ts`, `tests/lint-report.test.ts`, `package.json`

**Estimated scope:** S

## Task 12a: Report facts bundle

**Description:** Pure, tested functions in `src/lib/report-facts.ts` that build everything the writer may cite. `buildFacts(season, week)` returns one JSON object with:
- **Scores and matchups:** every game, with each side's top and bottom starter.
- **Bench blunders:** `optimalLineup()` fills fixed slots (QB, RB, RB, WR, WR, TE, K, DEF) with the best eligible players, then FLEX with the best remaining RB, WR, or TE. Points left on bench = optimal minus actual. Flags "would have won with the best lineup" and picks a coach of the week (smallest gap) and a worst coach.
- **Power ranking movers:** the biggest risers and fallers, with score, all play, and last 3 changes.
- **Transactions:** completed adds, drops, and trades for the week from `/league/{id}/transactions/{week}` (failed waiver claims skipped). Flags a player dropped earlier who scored 15 or more for another team this week.
- **Injury report:** rostered starters with an injury status from `players.json`.
- **Next week:** pairings from `/matchups/{week + 1}`, with each team's record, last 3 points, and power rank.
- **Also:** standings changes, `facts()`, and Sleeper trending adds and drops.

**Acceptance criteria:**
- [x] `optimalLineup()` is tested on a hand built roster, including a FLEX case and an empty slot
- [x] Every number in the bundle traces to Sleeper data, and a test checks the bundle against week 4 fixtures
- [x] Fetching adds at most about 5 Sleeper calls on top of `loadSeason()`

**Verification:**
- [x] `npm test`: `tests/report-facts.test.ts`
- [x] Manual: printed the live week 4 bundle. Stronger check than a spot check: our best lineups summed over weeks 1 to 4 equal Sleeper's own potential points (ppts) for all 12 teams, now a permanent test

**Dependencies:** T6, T7, T8

**Files likely touched:** `src/lib/report-facts.ts`, `src/lib/sleeper.ts`, `tests/report-facts.test.ts`, `tests/fixtures/transactions-4.json`

**Estimated scope:** M

## Task 12b: Report writer script

**Description:** `npm run report -- --week N` calls `buildFacts()`, adds the top 10 ESPN RSS headlines (parsed with a simple regex on `<item><title>`), and calls `claude-opus-5-5` through Claude Code headless (`claude -p`) on your subscription, with tools disabled and no user settings or plugins. The system prompt is `writing-style.md`, plus rules for the nine sections in `SPEC.md`:
- Use only the facts given, and never invent stats or news.
- Friendly trash talk by name, aimed at decisions and results, never personal.
- Never copy ESPN wording.

The script writes the markdown with frontmatter and runs the linter. If the lint fails, it retries once with the list of violations. Pure helpers (RSS parsing, prompt, draft parsing, section check, frontmatter) live in `src/lib/report-writer.ts` with tests.

**Acceptance criteria:**
- [x] It writes `src/content/reports/{season}/week-{N}.md` with all nine sections, and the file passes `lint:report`
- [x] If the RSS fetch fails, the run still finishes, skips the NFL news section, and logs a warning
- [x] If the `claude` command is missing or not logged in, the script stops with a clear message

**Verification:**
- [x] Manual: ran it for week 4 and checked every claim against the bundle and ESPN. The first draft invented a Tyreek Hill story (the real headline was about a trial), made a false "leads the league" claim, and gendered managers. Rules added for all three, guarded by tests. The second draft checked out

**Dependencies:** T12a, T9, T11

**Files likely touched:** `scripts/write-report.ts`, `package.json`

**Estimated scope:** M

## Task 13: Weekly report GitHub Action

**Description:** `weekly-report.yml` runs on cron `0 15 * * 2` (Tuesdays) and on `workflow_dispatch`, with a week input. It installs Claude Code and runs it with the `CLAUDE_CODE_OAUTH_TOKEN` secret. On the Tuesday schedule only, it runs `npm run players` (the only weekly `/players/nfl` call; manual reruns use the committed list), then runs the writer for the last completed week, lints the result, and opens the PR `{season} Week N report` (for example `2026 Week 4 report`) on the branch `report/{season}-week-{N}`. The workflow only has `contents: write` and `pull-requests: write` permissions.

GitHub doesn't run `ci.yml` on PRs opened with the built in `GITHUB_TOKEN`. That's on purpose, to prevent workflow loops. So this job runs the same checks itself **before** it opens the PR: `npm test`, `npm run check`, `npm run build`, the `dist/` secret guard, and `lint:report`. The PR body says the checks ran in the weekly job. Cloudflare still builds its own preview of the PR, because that comes from Cloudflare's GitHub app, not from Actions.

Notes:
- Cron times are in UTC. `0 15 * * 2` is Tuesday 10am Central Daylight Time and 9am Central Standard Time. Monday night games finish well before then.
- GitHub turns off scheduled workflows after 60 days with no repo activity. Merging the weekly PRs counts as activity, so this only matters in the offseason. The first run of each season may need a manual re enable.

**Done so far:** workflow written and passes actionlint 1.7.12 and a YAML parse. The week input is checked as a number (an injection attempt is rejected), and the branch name parsing was dry run. The rest needs the human's first dispatch.

**Acceptance criteria:**
- [x] A manual dispatch opens a PR with the report file and the refreshed `src/data/players.json`
- [x] A failing test, check, build, secret guard, or lint fails the job and opens no PR
- [x] Re running for a week that already has an open PR updates that PR instead of failing or opening a duplicate
- [x] The secret never shows up in the logs

**Verification:**
- [x] Manual: dispatched 3 times. PR #1 "2026 Week 4 report" opened, then updated in place and retitled. The Cloudflare preview built. Merging is up to the human

**Dependencies:** T12b, T4

**Files likely touched:** `.github/workflows/weekly-report.yml`

**Estimated scope:** S

## Checkpoint C: Report pipeline
- [x] The PR opened by the workflow passed its own checks (which stand in for `ci.yml`), has a Cloudflare preview, and reads like a newspaper
- [ ] PDF and PNG export work on the live site
- [ ] Review with the human before going on

## Phase 4: League history

## Task 14: History data layer

**Description:** `src/lib/history.ts` follows `previous_league_id` back to 2024. It stops on a repeated league ID or after 30 seasons, so bad data can't cause a fetch loop and loads each season's league, users, rosters, matchups, and winners bracket. It maps each roster to its `owner_id` (user_id). For each completed season it works out:
- the champion and runner up, from the winners bracket
- the punishment loser, which is last place in the regular season `standings()`

The all time stats are:
- W/L/T, PF, and seasons played per manager (regular season only)
- playoff appearances and titles
- a punishment count per manager
- the records book
- the head to head matrix

**Acceptance criteria:**
- [x] The 2025 champion is roster 6's owner, and 2024 is roster 3's owner
- [x] The chain walk stops on a cycle (tested with a fake `previous_league_id` loop)
- [x] The punishment loser for each season is the last place team in that season's regular season standings
- [x] Each manager's all time wins equal the sum of their per season wins across the 10 team and 12 team seasons
- [x] Each head to head pair is symmetric: A's wins against B equal B's losses against A

**Verification:**
- [x] `npm test`: `tests/history.test.ts` with trimmed fixtures from 2024 and 2025

**Dependencies:** T3, T8 (reuses the standings and facts helpers)

**Files likely touched:** `src/lib/history.ts`, `src/lib/sleeper.ts`, `tests/history.test.ts`, `tests/fixtures/history/*.json`

**Estimated scope:** M

## Task 15: `/history` overview page

**Description:** Render four sections:
- the champions banner, one card per completed season, each showing the champion, runner up, and punishment loser
- the all time table
- the records book
- the head to head grid, which uses the same scroll container as the what if grid

**Acceptance criteria:**
- [ ] All four sections render with real data
- [ ] Managers who joined in 2025 show the right count of seasons played
- [ ] No horizontal page scroll at 360px

**Verification:**
- [ ] Manual: check the page against what you know about the league's history

**Dependencies:** T14

**Files likely touched:** `src/pages/history/index.astro`

**Estimated scope:** S

## Task 16: `/history/{season}` with the draft board

**Description:** Fetch the draft picks from `/draft/{draft_id}/picks`. The page shows:
- the final standings and the playoff bracket
- the draft board grid, with rounds as rows and slots as columns, each cell color coded by position
- the hits and busts: each player's season points rank compared with the pick's spot in the draft, showing the top 5 and bottom 5

The in progress 2026 season shows its draft but leaves out the bracket.

**Acceptance criteria:**
- [ ] The 2024 board has 10 columns and the 2025 board has 12. Every pick shows the player and position
- [ ] The hits and busts lists come from `players_points` totals for the season
- [ ] The 2026 page renders without a bracket

**Verification:**
- [ ] `npm test`: the hit and bust ranking function
- [ ] Manual: spot check three picks against the Sleeper draft recap

**Dependencies:** T14

**Files likely touched:** `src/lib/history.ts`, `src/lib/sleeper.ts`, `tests/history.test.ts`, `src/pages/history/[season].astro`

**Estimated scope:** M

## Checkpoint D: Done
- [ ] Every success criterion in `SPEC.md` is checked
- [ ] Lighthouse mobile scores are 95 or higher for performance and accessibility on every page
- [ ] Final review with the human
