# Tasks: Illini Fantasy Report

Each task needs `npm test && npm run check && npm run build` to pass before it counts as done. See `tasks/plan.md` for context.

## Phase 1: Foundation

## Task 1: Scaffold Astro, Vitest, and CI

**Description:** Create the empty project. Astro 5 builds to static output with strict TypeScript. Vitest runs the tests. `.env.example` holds placeholders. A CI workflow runs test, check, build, audit, and the secret guard on every PR.

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
- [ ] The table shows rank, team, manager, W/L/T, PF, PA, and streak, sorted by wins then PF
- [ ] Only weeks `1..last_scored_leg` count
- [ ] The values match the Sleeper app

**Verification:**
- [ ] `npm test`: standings sort order, ties, and streak, all against fixtures
- [ ] Manual: compare `/standings` with the Sleeper app

**Dependencies:** T2

**Files likely touched:** `src/lib/sleeper.ts`, `src/lib/stats.ts`, `tests/fixtures/*.json`, `tests/stats.test.ts`, `src/pages/standings.astro`

**Estimated scope:** M

## Task 4: Deploy to Cloudflare Pages with security headers and daily refresh

**Description:** Add `public/_headers` with a strict CSP that allows the inline theme script by its hash, plus `nosniff`, `Referrer-Policy`, and `frame-ancestors 'none'`. Add `refresh.yml`, which runs daily at 10:00 UTC and POSTs to `CF_DEPLOY_HOOK_URL`. **You** do the Cloudflare and GitHub setup listed in `plan.md`.

**Acceptance criteria:**
- [ ] The site is live at `*.pages.dev`, and the browser console shows no CSP errors
- [ ] securityheaders.com grades the site A or better
- [ ] A manual `workflow_dispatch` of `refresh.yml` triggers a new deploy

**Verification:**
- [ ] Manual: open the live URL, check the console, and run securityheaders.com
- [ ] Manual: run the refresh workflow and watch the Pages deploy log

**Dependencies:** T3

**Files likely touched:** `public/_headers`, `.github/workflows/refresh.yml`

**Estimated scope:** S

## Checkpoint A: Live skeleton
- [ ] All tests pass, and the build is clean
- [ ] The live URL shows the real standings, and the theme toggle works there
- [ ] Review with the human before going on

## Phase 2: League stats pages

## Task 5: What if matrix

**Description:** Add `recordWithSchedule(weeks, a, b)` and `whatIfMatrix()`. Render a 12×12 grid with the diagonal highlighted. The grid scrolls sideways inside its own container. The first column (team names) stays fixed in place.

**Acceptance criteria:**
- [ ] The diagonal equals each team's actual record
- [ ] When B's opponent was A, the cell compares A's score to B's score
- [ ] At 360px the grid scrolls inside its container, and the page doesn't scroll sideways

**Verification:**
- [ ] `npm test`: diagonal, the swap rule, and ties
- [ ] Manual: check the page at 360px

**Dependencies:** T3

**Files likely touched:** `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/what-if.astro`

**Estimated scope:** S

## Task 6: Overall power rankings

**Description:** Add `allPlay()` and `powerRankings(weeks, upToWeek)` using the 50/30/20 formula, with min/max normalization. Compute the rankings through the last week and the week before it to get the ▲/▼ movement.

**Acceptance criteria:**
- [ ] The scores follow the formula in the spec
- [ ] The movement arrows reflect the rank change from last week, with no arrow in week 1
- [ ] The page lists rank, team, score, all play record, and movement

**Verification:**
- [ ] `npm test`: all play math against fixtures, plus ordering
- [ ] Manual: spot check one team's all play record by hand

**Dependencies:** T3

**Files likely touched:** `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/power-rankings.astro`

**Estimated scope:** S

## Task 7: Positional power rankings

**Description:** Add a memoized `players()` fetcher, trimmed to id, name, position, and team. Add `positionPoints()`, which sums `starters_points` by each player's real position. Add QB, RB, WR, TE, K, and DEF tabs to `/power-rankings`. The tabs use radio inputs and CSS, so they need no JS.

**Acceptance criteria:**
- [ ] A FLEX WR counts toward WR
- [ ] Each tab ranks all 12 teams by season starter points at that position
- [ ] The tabs work with the keyboard

**Verification:**
- [ ] `npm test`: position sums against fixtures, including a FLEX case
- [ ] Manual: switch tabs on mobile and desktop

**Dependencies:** T6

**Files likely touched:** `src/lib/sleeper.ts`, `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/power-rankings.astro`

**Estimated scope:** S

## Task 8: Interesting facts on standings

**Description:** `facts()` returns 3 to 5 facts: the highest single week score, the most points against, the biggest blowout, the longest current win streak, and the closest game. Show them in a block on `/standings`.

**Acceptance criteria:**
- [ ] Each fact names the team, the week, and the number
- [ ] The block skips facts that aren't defined yet, for example a streak in week 1

**Verification:**
- [ ] `npm test`: each fact against fixtures

**Dependencies:** T3

**Files likely touched:** `src/lib/stats.ts`, `tests/stats.test.ts`, `src/pages/standings.astro`

**Estimated scope:** S

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

Add the `/reports` index and the report pages. The home page shows the latest headline, the lede, and the top 3 in the standings. Write one sample report by hand for week 4. Raw HTML in the markdown must not render.

**Acceptance criteria:**
- [ ] The report reads as a newspaper in light and dark mode, at 360px and on desktop
- [ ] HTML put into the sample report shows up escaped, or not at all
- [ ] The home page links to the latest report

**Verification:**
- [ ] Build succeeds
- [ ] Manual: look at the page at three widths in both themes

**Dependencies:** T3 (scores for the box score)

**Files likely touched:** `src/content.config.ts`, `src/layouts/ReportLayout.astro`, `src/pages/reports/[...slug].astro`, `src/pages/reports/index.astro`, `src/pages/index.astro`, `public/fonts/*.woff2`, `src/content/reports/2026/week-4.md`

**Estimated scope:** M (7 files, but most are small)

## Task 10: Save PDF and Save image export

**Description:** A print stylesheet hides the nav and buttons, forces light colors, sets `@page { size: letter }`, and avoids column breaks inside paragraphs. "Save PDF" calls `window.print()`. "Save image" dynamically imports `html-to-image`, renders the article at a fixed 1080px width, and downloads `illini-report-{season}-week-{n}.png`. Adding `html-to-image` is already approved in the spec.

**Acceptance criteria:**
- [ ] The printed PDF is 1 to 2 letter pages with no nav or buttons, in Chrome and Safari
- [ ] The PNG is 1080px wide and includes the masthead font. The font must be embedded, not swapped for a fallback
- [ ] The page's on load JS stays under 5 KB, because `html-to-image` loads only when clicked

**Verification:**
- [ ] Manual: export both formats on desktop Chrome, desktop Safari, and an iPhone
- [ ] Manual: the DevTools network tab shows no `html-to-image` request until the button is clicked

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
- [ ] Each banned pattern has a failing test case
- [ ] "Amon-Ra St. Brown" passes, and "game-changer" fails
- [ ] Frontmatter is skipped

**Verification:**
- [ ] `npm test`: `tests/lint-report.test.ts`
- [ ] `npm run lint:report -- src/content/reports/2026/week-4.md` passes on the sample

**Dependencies:** T7 (players list)

**Files likely touched:** `scripts/lint-report.ts`, `tests/lint-report.test.ts`, `package.json`

**Estimated scope:** S

## Task 12: Report writer script

**Description:** `npm run report -- --week N` builds a facts bundle. The bundle includes:
- the scores
- each matchup's top and bottom starters
- standings changes
- power ranking changes
- injury statuses of rostered starters
- trending adds and drops
- the top 10 ESPN RSS headlines, parsed with a simple regex on `<item><title>`

The script calls `claude-opus-5-5` with `writing-style.md` as the system prompt, plus rules: use only the facts given, name managers, and use newspaper structure. It writes the markdown with frontmatter, then runs the linter. If the lint fails, it retries once and sends the model the list of violations. Load the `claude-api` skill before writing this.

**Acceptance criteria:**
- [ ] It writes `src/content/reports/{season}/week-{N}.md`, and the file passes `lint:report`
- [ ] If the RSS fetch fails, the run still finishes and logs a warning
- [ ] Without `ANTHROPIC_API_KEY`, the script stops with a clear message before calling the API

**Verification:**
- [ ] Manual: run it locally for week 4 with your key, read the output, and check every number against the Sleeper app

**Dependencies:** T6, T7, T9, T11

**Files likely touched:** `scripts/write-report.ts`, `package.json`

**Estimated scope:** M

## Task 13: Weekly report GitHub Action

**Description:** `weekly-report.yml` runs on cron `0 15 * * 2` (Tuesdays) and on `workflow_dispatch`, with a week input. It runs the writer for the last completed week, lints the result, and opens the PR `Week N report` on the branch `report/{season}-week-{N}`. The workflow only has `contents: write` and `pull-requests: write` permissions.

**Acceptance criteria:**
- [ ] A manual dispatch opens a PR with the report file
- [ ] A lint failure fails the job and opens no PR
- [ ] The secret never shows up in the logs

**Verification:**
- [ ] Manual: dispatch the workflow, read the PR, merge it, and confirm the report goes live

**Dependencies:** T12, T4

**Files likely touched:** `.github/workflows/weekly-report.yml`

**Estimated scope:** S

## Checkpoint C: Report pipeline
- [ ] The PR opened by the workflow passes CI and reads like a newspaper
- [ ] PDF and PNG export work on the live site
- [ ] Review with the human before going on

## Phase 4: League history

## Task 14: History data layer

**Description:** `src/lib/history.ts` follows `previous_league_id` back to 2024 and loads each season's league, users, rosters, matchups, and winners bracket. It maps each roster to its `owner_id` (user_id). For each completed season it works out:
- the champion and runner up, from the winners bracket
- the punishment loser, which is last place in the regular season `standings()`

The all time stats are:
- W/L/T, PF, and seasons played per manager (regular season only)
- playoff appearances and titles
- a punishment count per manager
- the records book
- the head to head matrix

**Acceptance criteria:**
- [ ] The 2025 champion is roster 6's owner, and 2024 is roster 3's owner
- [ ] The punishment loser for each season is the last place team in that season's regular season standings
- [ ] Each manager's all time wins equal the sum of their per season wins across the 10 team and 12 team seasons
- [ ] Each head to head pair is symmetric: A's wins against B equal B's losses against A

**Verification:**
- [ ] `npm test`: `tests/history.test.ts` with trimmed fixtures from 2024 and 2025

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
