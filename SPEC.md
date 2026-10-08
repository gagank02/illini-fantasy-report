# Spec: Illini Fantasy Report

## Objective

A lightweight website for our 12 team Sleeper fantasy football league. League members visit it each week to read a newspaper style recap and check standings, power rankings, and a "what if" schedule matrix.

**Users:** League members (12 managers), on phone or desktop. No logins. The site is public but unlisted.

**Success looks like:** Every Tuesday a new report appears as a PR. The commissioner reads it, merges it, and the site updates on its own. Every other page refreshes daily from Sleeper with no manual work.

### Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `sleeper-data` | Fetch and type Sleeper league, rosters, users, matchups, trending. Rate limited. Players come from a committed file | none |
| `league-stats` | Pure functions: standings, what if matrix, power rankings, fun facts | `sleeper-data` |
| `site` | Astro pages, layout, UIUC theme, light/dark toggle | `league-stats` |
| `weekly-report` | Script + GitHub Action that drafts the recap with Claude and opens a PR | `league-stats`, `sleeper-data` |
| `history` | Walk the `previous_league_id` chain and build all time records, champions, drafts | `sleeper-data`, `league-stats` |

Build order: `sleeper-data` → `league-stats` → `site` → `history`, `weekly-report`

The site is small, so all four modules live in this one spec and don't get separate spec files.

### Features and acceptance criteria

**1. Standings** (`/standings`)
- Table with rank, team name, manager, W/L/T, points for, points against, streak.
- Sorted by wins, then points for (Sleeper's default tiebreak).
- Last 5 form badges, and league ranks for PF and PA.

**2. What if matrix** (`/what-if`)
- A 12×12 grid. The cell at row A, column B shows team A's record if A had played B's schedule.
- Rule: in each week, A's score is compared to the score of the opponent B faced that week. If B's opponent was A, compare A's score to B's score.
- The diagonal is the team's actual record and is highlighted.
- Phones (under 48rem) get an expandable list instead of the grid. Each team shows its actual record and its range, and tapping it lists the team's record with every other schedule. Nothing scrolls sideways. Cells and list rows are shaded green (▲) or red (▼) when the schedule beats or hurts the actual record.

**3. Power rankings** (`/power-rankings`)
- Overall score = 50% all play win % + 30% points for (normalized) + 20% last 3 weeks' points (normalized).
- "Vs. everyone" record (all play) = your record if you'd played every team every week. The page calls it "Vs. everyone" and explains it in the intro, because "all play" confused readers.
- Shows each team's movement (▲/▼) versus last week.
- Positional tab for QB, RB, WR, TE, K, DEF. Teams are ranked by season total starter points at that position.

**4. Weekly report** (`/reports`, `/reports/{season}/week-{n}`)
- Reads like a sports page. Sections, in order:
  1. **Headline and lede.**
  2. **Game by game:** every matchup, with jabs.
  3. **Player of the week and bust of the week.**
  4. **Bench blunders:** points each manager left on the bench compared with their best possible lineup. Includes a "Coach of the week" (closest to the best lineup) and a "Worst coach" (most points left on the bench, especially in a loss they would have won).
  5. **Stock up and stock down:** the biggest power ranking risers and fallers, and why.
  6. **Transactions:** this week's adds, drops, and trades in our league, plus callouts like a dropped player who scored big elsewhere.
  7. **Injury report:** rostered starters listed Out, Doubtful, Questionable, or on IR, and which teams they hurt.
  8. **Fantasy news:** injury statuses and Sleeper's trending adds and drops. No outside news sites (see Decisions).
  9. **Next week:** each matchup with both teams' form and season scoring, plus a pick. Sleeper's public API has no projections, so picks use only our own stats.
- **Tone:** friendly trash talk, by name. Jabs target decisions and results (bad starts, bench blunders, blowouts, waiver misses), never anything personal.
- Written by Claude (`claude-opus-5-5`) through **Claude Code in headless mode** (`claude -p`) on the commissioner's Claude Pro or Max **subscription**, not a paid API key. It runs with `writing-style.md` plus the report rules as the system prompt, all tools disabled, and no user settings or plugins. The prompt also gets a facts bundle with scores, top players, standings changes, the "Around the league" facts, bench blunders, power ranking movers, league transactions, Sleeper injury statuses, trending adds/drops, and next week's matchups.
- The model gets facts only and never invents stats. Every number in the report comes from the facts bundle.
- A style check script fails the PR when the report contains em/en dashes, semicolons, emojis, `*`, hashtags, raw HTML, or phrases from a banned list (seeded from `writing-style.md`).
- The home page (`/`) is the weekly front door. It has these parts.
  - The latest report's headline and lede, linking to the report (added in T9).
  - Preview cards linking to each tab: the standings top 3, the power rankings top 3 with movement and the biggest riser, and What If's luckiest and unluckiest schedules. Luck is actual wins minus average wins across every schedule.
  - "Around the league," 3 to 5 computed facts: the highest score, toughest luck (most points against), biggest blowout, closest game, and hottest team (2 or more straight wins).
  - History is not previewed on the home page.
- The report's facts bundle includes the same "Around the league" facts.
- **Looks like a newspaper.** The page has these elements.
  - A masthead ("The Illini Fantasy Report") in a blackletter display font, with a dateline row showing volume (season), issue (week), and date.
  - A serif body (Georgia stack) on an off white "newsprint" background in light mode.
  - Thin rules between sections, a large headline, a drop cap on the lede, and a box score sidebar.
  - Text in multiple columns: 3 on desktop, 2 on tablet, 1 on mobile.
  - Dark mode keeps the layout and swaps to a dark paper tone.
- **Export as PDF.** A "Save PDF" button calls `window.print()`. A print stylesheet hides the nav and buttons, forces light colors, and lays out a letter size page. The browser's "Save as PDF" does the rest, so no PDF library is needed.
- **Export as picture.** A "Save image" button renders the article to a PNG with `html-to-image`. The library loads only on click, through a dynamic import, so it costs nothing on page load. The image is a fixed 1080px wide, so it looks the same from any device and is easy to share in a group chat.

**5. Theme and layout**
- UIUC colors are Illini Orange `#FF5F05` and Illini Blue `#13294B`. Accent text on dark backgrounds meets WCAG AA contrast.
- Light/dark mode follows `prefers-color-scheme` by default. A toggle overrides it and is saved in `localStorage`.
- Works from 360px up to desktop. Top nav collapses to a simple menu on mobile.

**6. League history** (`/history`, `/history/{season}`)
- Seasons come from the `previous_league_id` chain. The league ID is `1386106937921253376`. I checked the live chain on 2026-10-06 and it covers 2024 (10 teams), 2025 (12), and 2026 (12, in season). New seasons get picked up automatically.
- Managers are tracked by Sleeper `user_id`, not roster ID, because roster IDs reset each season and team names change.
- The `/history` page has these sections.
  - **Champions banner:** The champion and runner up for each completed season, taken from `/winners_bracket`. The banner also shows that season's **punishment loser**, the team with the worst regular season record. Ties are broken by fewer points for. The losers bracket is ignored.
  - **All time table:** Each manager's seasons played, W/L/T, win %, total points for, playoff appearances, and titles.
  - **Records book:** The highest and lowest weekly score ever, the biggest blowout, the best and worst season records, and the longest win and losing streaks.
  - **Head to head grid:** Every manager's all time record against every other manager.
- The `/history/{season}` page has these sections.
  - The final standings and the playoff bracket.
  - **Full draft board:** A round by round grid from `/draft/{id}/picks`, with each pick's player, position, and team.
  - **Draft hits and busts:** Each pick's season points compared with its draft slot, to show the best and worst picks.
- Stats don't change for completed seasons, so their data is fetched at build time like everything else. That's about 20 Sleeper calls per past season.

**7. Security**
- Fully static output. No server, no database, no user input.
- The Claude Code OAuth token exists only as a GitHub Actions secret and never reaches the client bundle.
- Strict CSP via Cloudflare `_headers`: `default-src 'self'`, no inline scripts except the theme snippet (hashed), plus `X-Content-Type-Options`, `Referrer-Policy`, and `frame-ancestors 'none'`.
- Report markdown renders with raw HTML disabled. `src/lib/markdown.ts` is a Sätteri plugin (Astro 7's markdown engine) that turns raw HTML into visible text and images into alt text. Tests prove Sätteri passes `<script>` through without it.
- `npm audit --omit=dev` runs clean in CI.

### Out of scope for v1 (stretch)
- Player value "stock chart" (risers/fallers)

## Tech Stack

- **Astro 7** (static output) + TypeScript (strict). Ships almost no client JS. The theme toggle and position tabs are the only scripts.
- **Report export:** `html-to-image` (about 10 KB, lazy loaded) for PNG. PDF uses the browser's print to PDF with a print stylesheet.
- **Fonts:** One self hosted blackletter font for the masthead: `public/fonts/UnifrakturMaguntia-Book.ttf`, unmodified from the google/fonts repo (SIL Open Font License 1.1, Reserved Font Name "UnifrakturMaguntia"). It ships as TTF, not converted to woff2, so it stays an unmodified copy that may keep its name. The license text ships as `public/fonts/OFL.txt`. Body text uses system serif fonts. Fonts live under `public/fonts/` because the CSP blocks third party font hosts.
- **Data:** Sleeper public API (`https://api.sleeper.app/v1`). It's free with no key. Fetching happens **at build time only**, so the browser never calls Sleeper.
- **Sleeper rate limits:** Sleeper may IP block anyone above 1000 calls a minute, and asks that `/players/nfl` be called at most once a day.
  - **Per URL:** Each URL is fetched at most once per process. `get()` caches it.
  - **Rate limiter:** In `sleeper.ts`, it caps each process at 600 calls a minute. A normal build uses about 100. The cap only matters if a bug causes a call loop.
  - **Players list:** `/players/nfl` is never called by builds or the dev server. `scripts/update-players.ts` writes a trimmed `src/data/players.json` (id, name, position, NFL team, injury status, and injury body part for injured players when Sleeper sends one; Sleeper's docs don't list that field, so `npm run players` logs how many it got). Two workflows run it, sharing one GitHub Actions cache key per UTC day (`sleeper-players-DATE`): the daily refresh at 10:17 UTC and the weekly report. Whichever runs first fetches and caches; the other reuses the cache. So Sleeper's list is called at most once a day, reruns never add calls, injury data is never more than a day old, and the daily refresh commits the new file so the site's injury tags stay current.
  - **History walk:** Following `previous_league_id` stops on a repeated ID or after 30 seasons.
- **Report writer:** the `claude` CLI (Claude Code) in headless mode, run by Node 24. Its only data source is Sleeper. There's no SDK dependency. Locally it uses your logged in subscription. In GitHub Actions it uses `CLAUDE_CODE_OAUTH_TOKEN` (made with `claude setup-token`).
- **Tests:** Vitest 5.
- **Toolchain:** Node 22 or newer with **npm 11**. npm 10 crashes while resolving Vitest 5's peer dependencies (`Cannot read properties of null (reading 'edgesOut')`). CI uses Node 24, which ships with npm 11.
- **Hosting:** Cloudflare Pages (free), building from `main`. A scheduled GitHub Action calls a Pages deploy hook daily so data stays fresh.
- **Domain (later):** Buy one through Cloudflare Registrar (sold at cost, about $10/yr for `.com`). Add it under Pages → Custom domains. No code changes needed.

## Commands

```
Install:      npm ci
Dev:          npm run dev                      # astro dev, http://localhost:4321
Build:        npm run build                    # astro build → dist/
Preview:      npm run preview
Test:         npm test                         # vitest run
Typecheck:    npm run check                    # astro check
Draft report: npm run report -- --week 5       # writes src/content/reports/2026/week-5.md
Style check:  npm run lint:report -- src/content/reports/2026/week-5.md
```

Required env:
- `SLEEPER_LEAGUE_ID` (build + report)
- `CLAUDE_CODE_OAUTH_TOKEN` (report only, CI secret, made with `claude setup-token`; uses your Claude subscription)
- `CF_DEPLOY_HOOK_URL` (daily refresh, CI secret)

### Secrets handling
- `.gitignore` already ignores `.env` and `.env.*`. Only `.env.example`, holding placeholder values, gets committed.
- Secrets live in exactly two places: your local `.env` (only `SLEEPER_LEAGUE_ID` is needed locally, since Claude Code uses your login) and GitHub → Settings → Secrets and variables → Actions. Cloudflare Pages needs only `SLEEPER_LEAGUE_ID`, which isn't secret.
- No code reads the secrets except Node scripts under `scripts/`. Astro only exposes env vars prefixed `PUBLIC_` to the browser, and we never use that prefix for secrets.
- **GitHub push protection:** Turn it on under Settings → Code security → Secret scanning. Then GitHub rejects any push containing an Anthropic key. It's free on public repos.
- **CI guard:** After every build, CI greps `dist/` for `sk-ant-` and the deploy hook host. It fails if either shows up.
- Workflows never `echo` secrets, and GitHub masks them in logs anyway.
- The OAuth token grants use of your Claude subscription. If it leaks, revoke it by running `claude setup-token` again or from your Claude account settings, and replace the GitHub secret.

## Project Structure

```
src/
  lib/sleeper.ts          → typed fetch wrappers for Sleeper endpoints
  lib/stats.ts            → standings, whatIf, powerRankings, facts (pure functions)
  pages/                  → index, standings, what-if, power-rankings, reports/[...slug]
  layouts/Base.astro      → nav, theme toggle, footer
  styles/global.css       → color tokens, light/dark, base type
  content/reports/{season}/week-{n}.md  → published reports (content collection)
scripts/
  write-report.ts         → builds facts bundle, calls Claude, writes markdown
  update-players.ts       → fetches /players/nfl once, writes trimmed src/data/players.json
  lint-report.ts          → style rule checker
.env.example              → placeholder env vars (real .env is gitignored)
tests/
  fixtures/               → saved Sleeper JSON from a real week
  stats.test.ts
  lint-report.test.ts
.github/workflows/
  ci.yml                  → test + check + build + audit on PRs
  weekly-report.yml       → Tue 15:23 UTC: draft report, lint, open PR
  refresh.yml             → daily: hit Cloudflare deploy hook
public/_headers           → security headers
writing-style.md          → report system prompt (source of truth for voice)
```

## Code Style

Plain functions, no classes, explicit types on exports, data in and data out.

```ts
// src/lib/stats.ts
export type WeekScores = Map<number, { rosterId: number; points: number; opponentId: number }[]>;

/** Record team `a` would have with team `b`'s schedule. */
export function recordWithSchedule(weeks: WeekScores, a: number, b: number): Record3 {
  const rec = { w: 0, l: 0, t: 0 };
  for (const games of weeks.values()) {
    const mine = games.find(g => g.rosterId === a)!;
    const theirs = games.find(g => g.rosterId === b)!;
    const opp = theirs.opponentId === a ? theirs.points : games.find(g => g.rosterId === theirs.opponentId)!.points;
    if (mine.points > opp) rec.w++; else if (mine.points < opp) rec.l++; else rec.t++;
  }
  return rec;
}
```

- `camelCase` functions/vars, `PascalCase` types and Astro components, `kebab-case` file names (except components).
- CSS uses custom properties on `:root` (`--orange`, `--blue`, `--bg`, `--fg`). No CSS framework.
- No new runtime dependency without asking.

## Testing Strategy

- **Vitest unit tests** cover everything in `src/lib/stats.ts` and `scripts/lint-report.ts`, using saved Sleeper fixtures. Key cases:
  - The what if diagonal equals the actual record.
  - The what if "B played A" swap rule.
  - Ties.
  - All play math.
  - Power ranking ordering.
  - The lint script catching each banned pattern.
- **No tests** for Astro pages or Sleeper fetch wrappers. A successful `npm run build` against the live league is the integration check.
- **Manual check:** each report PR gets read by a human before merge. That review *is* the test for writing quality.
- CI must be green (test + check + build) before merging to `main`.

## Boundaries

- **Always:** Make icons and graphics ourselves (inline SVG or Unicode). Ship a font's license file next to the font. Keep the footer line saying the site isn't affiliated with the University of Illinois, Sleeper, or the NFL. Keep Sleeper fetches at build time. Run `npm test && npm run check` before committing. Pass reports through `lint:report`. Use `writing-style.md` verbatim as the system prompt.
- **Ask first:** Adding any npm dependency. Changing the power ranking formula. Switching the Claude model. Adding client side JS beyond the theme toggle, tabs, and report export buttons. Changing hosting.
- **Never:** Add ads, paid features, or anything commercial (Sleeper's free API is non-commercial only). Feed outside news sites to the report writer without first confirming their terms allow automated access and use with AI. Use NFL, team, or University of Illinois logos (including the Block I), player headshots, or Sleeper avatars. Copy news article text into reports (headlines are inputs only, and the report states the facts in its own words). Add any image, icon, or font without a license that allows it. Call `/players/nfl` from a build or page. Read `src/data/players.json` instead. Commit API keys or `.env`. Call Claude from the browser. Auto merge a report PR. Let the model state numbers that aren't in the facts bundle. Render raw HTML from report markdown.

## Success Criteria

- [x] `npm run build` with the real league ID produces all pages with no errors. *CI green on every push*
- [x] Standings match Sleeper's app for the current week. *tested against Sleeper's own roster W/L/T, PF, PA, record, streak for all 12 teams*
- [x] What if diagonal matches actual records for all 12 teams. *tested*
- [x] Lighthouse mobile score ≥ 95 for performance and accessibility on every page. *2026-10-07: 100/100/100 (perf, a11y, best practices) on 8 live pages, CLS 0*
- [x] Total JS shipped per page < 5 KB on load. The lazy `html-to-image` chunk doesn't count toward this. *406 B on every page, 2.8 KB on reports*
- [ ] "Save PDF" prints a report to a clean 1 to 2 page letter PDF with no nav or buttons, in light colors, from both Chrome and Safari. *Chrome verified (1 page). Safari: human check pending*
- [ ] "Save image" downloads a 1080px wide PNG of the full article from both mobile and desktop. *Chrome desktop and mobile emulation verified. iPhone Safari: human check pending*
- [x] Theme toggle works, persists, and has no flash of the wrong theme on load. *verified in Chrome, including under the production CSP*
- [x] `weekly-report.yml` run manually opens a PR with a report that passes `lint:report`. *PR #1, merged*
- [x] `/history` lists the correct champion for 2024 and 2025 and shows each season's draft board. *tested against the bracket finals*
- [x] All time W/L per manager sums correctly across the 10 team and 12 team seasons. *tested against Sleeper's season win totals*
- [x] CI secret guard fails a build that contains a fake `sk-ant-` string. *verified in T1*
- [x] securityheaders.com grades the deployed site A or better. *Mozilla Observatory A+ (12/12), rescanned 2026-10-07 (securityheaders.com blocks automated scans)*
- [x] No horizontal page scroll at 360px width. *all 10 pages at 360px and 320px*

## Decisions

- League ID: `1386106937921253376`.
- News source: **Sleeper only.** ESPN's terms (Disney) forbid automated access and using their content in "prompting, fine-tuning, training" of AI tools, and its RSS terms forbid modifying headlines. Yahoo's terms forbid automated collection. CBS Sports and Pro Football Talk terms couldn't be verified. So the report's "Fantasy news" section uses only Sleeper injury statuses and trending data. Checked 2026-10-07. This is a cautious reading, not legal advice.
- **Injury tags** (P, Q, D, OUT, IR, PUP, SUS, DNR), plus the body part ("Ankle") when Sleeper sends `injury_body_part`, from `players.json` show next to players on the trade finder and on the in-progress season's draft board. They are today's status, so finished seasons show none. "NA" (not active) is skipped.
- Sleeper's API is free for **non-commercial** use only, and its trending data needs attribution. Every report shows a Sleeper credit line, and the site carries no ads or paid features.
- Hyphens: allowed only inside player names that match Sleeper's player list. Banned everywhere else.
- Tone: friendly trash talk by name, aimed at decisions and results, never personal.
- Power rankings: 50/30/20 weights.
- The punishment loser is the last place team in the regular season standings, not the loser of a bracket.
- History starts at 2024. There are no seasons before Sleeper.
- Trade finder (`/trades`): suggests trades that improve both teams' starting lineups, using FantasyCalc redraft values (2026-10-07). FantasyCalc's terms: only documented endpoints (we call `GET /values/current` only), cache and ideally fetch once a day, a visible FantasyCalc.com credit and link next to the data, non-commercial use, and no republishing their full value list. They ask for an email from a human before a public launch: sent by the commissioner, and FantasyCalc approved use under their Terms of Use (2026-10-08). Their Terms also forbid implying endorsement, so the footer says the site is not affiliated with or endorsed by FantasyCalc.
- Only `scripts/update-trades.ts` calls FantasyCalc, from the daily refresh job, at most once per UTC day, even after a failed call (a "called today" marker is cached pass or fail), and only when the `FANTASYCALC_ENABLED` repo variable is `true`. FantasyCalc's docs only ask for hourly at most, so this is stricter on purpose.
- **FantasyCalc's raw values are never committed.** They aren't ours to republish. The daily job keeps them in memory, computes the trade suggestions, and commits only `src/data/trades.json`: who gives and gets whom, each side's lineup gain, and how far apart the values were as a percentage. The page shows "Player values within N%" instead of totals, since a 1 for 1 total is a player's exact value. A test fails if a value field or any player's value appears in the saved file.
- Before computing, the script checks the join with Sleeper: the response must be a list, values must be positive numbers, and at least half of our rostered QB/RB/WR/TE must have a value, or yesterday's file stays. The run log lists players without a value (left out of trades) and any position that differs from Sleeper's.
- Suggestions are saved once a day, so each build hides any whose players have since changed teams. The Trades tab stays hidden until the first suggestions are saved. Builds, tests, CI, and previews never call FantasyCalc. `FANTASYCALC=sample` builds trades from made up values for local work and is ignored on Cloudflare.

## Open Questions

1. **Stretch features:** Player values come from FantasyCalc for the trade finder. The stock chart could reuse them.
