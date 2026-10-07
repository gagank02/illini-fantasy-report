# Spec: Illini Fantasy Report

## Objective

A lightweight website for our 12 team Sleeper fantasy football league. League members visit it each week to read a newspaper style recap and check standings, power rankings, and a "what if" schedule matrix.

**Users:** League members (12 managers), on phone or desktop. No logins. The site is public but unlisted.

**Success looks like:** Every Tuesday a new report appears as a PR. The commissioner reads it, merges it, and the site updates on its own. Every other page refreshes daily from Sleeper with no manual work.

### Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `sleeper-data` | Fetch and type Sleeper league, rosters, users, matchups, players, trending | none |
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
- An "interesting facts" block with 3 to 5 computed facts. Examples are highest single week score, unluckiest team (most points against), biggest blowout, and longest win streak.

**2. What if matrix** (`/what-if`)
- A 12×12 grid. The cell at row A, column B shows team A's record if A had played B's schedule.
- Rule: in each week, A's score is compared to the score of the opponent B faced that week. If B's opponent was A, compare A's score to B's score.
- The diagonal is the team's actual record and is highlighted.
- On mobile the grid scrolls sideways inside its own container. The page itself never scrolls sideways.

**3. Power rankings** (`/power-rankings`)
- Overall score = 50% all play win % + 30% points for (normalized) + 20% last 3 weeks' points (normalized).
- All play record = your record if you'd played every team every week.
- Shows each team's movement (▲/▼) versus last week.
- Positional tab for QB, RB, WR, TE, K, DEF. Teams are ranked by season total starter points at that position.

**4. Weekly report** (`/reports`, `/reports/{season}/week-{n}`)
- Reads like a sports page, with a headline, a lede, a game by game recap, and short items on the top performer, the bust of the week, and NFL news that matters for fantasy.
- Written by Claude (`claude-opus-5-5`) with `writing-style.md` as the system prompt. The prompt also gets a facts bundle with scores, top players, standings changes, Sleeper injury statuses, trending adds/drops, and the latest headlines from an NFL RSS feed.
- The model gets facts only and never invents stats. Every number in the report comes from the facts bundle.
- A style check script fails the PR when the report contains em/en dashes, semicolons, emojis, `*`, hashtags, raw HTML, or phrases from a banned list (seeded from `writing-style.md`).
- The home page (`/`) shows the latest report's headline and lede plus a top 3 standings snapshot.
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
- The Anthropic API key exists only as a GitHub Actions secret and never reaches the client bundle.
- Strict CSP via Cloudflare `_headers`: `default-src 'self'`, no inline scripts except the theme snippet (hashed), plus `X-Content-Type-Options`, `Referrer-Policy`, and `frame-ancestors 'none'`.
- Report markdown renders with raw HTML disabled.
- `npm audit --omit=dev` runs clean in CI.

### Out of scope for v1 (stretch)
- Player value "stock chart" (risers/fallers)

## Tech Stack

- **Astro 7** (static output) + TypeScript (strict). Ships almost no client JS. The theme toggle and position tabs are the only scripts.
- **Report export:** `html-to-image` (about 10 KB, lazy loaded) for PNG. PDF uses the browser's print to PDF with a print stylesheet.
- **Fonts:** One self hosted blackletter woff2 for the masthead (e.g. UnifrakturMaguntia, OFL licensed). Body text uses system serif fonts. Fonts live under `public/fonts/` because the CSP blocks third party font hosts.
- **Data:** Sleeper public API (`https://api.sleeper.app/v1`). It's free with no key and allows about 1000 calls a minute. Fetching happens **at build time only**, so the browser never calls Sleeper.
- **Report writer:** `@anthropic-ai/sdk`, plus a small RSS fetch with no parser dependency, run by Node 24 in GitHub Actions.
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
- `ANTHROPIC_API_KEY` (report only, CI secret)
- `CF_DEPLOY_HOOK_URL` (daily refresh, CI secret)

### Secrets handling
- `.gitignore` already ignores `.env` and `.env.*`. Only `.env.example`, holding placeholder values, gets committed.
- Real keys live in exactly two places: your local `.env` and GitHub → Settings → Secrets and variables → Actions. Cloudflare Pages needs only `SLEEPER_LEAGUE_ID`, which isn't secret.
- No code reads the secrets except Node scripts under `scripts/`. Astro only exposes env vars prefixed `PUBLIC_` to the browser, and we never use that prefix for secrets.
- **GitHub push protection:** Turn it on under Settings → Code security → Secret scanning. Then GitHub rejects any push containing an Anthropic key. It's free on public repos.
- **CI guard:** After every build, CI greps `dist/` for `sk-ant-` and the deploy hook host. It fails if either shows up.
- Workflows never `echo` secrets, and GitHub masks them in logs anyway.
- Set a monthly spend limit (e.g. $5) in the Anthropic console. If the key ever leaks, the damage stays capped.

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
  lint-report.ts          → style rule checker
.env.example              → placeholder env vars (real .env is gitignored)
tests/
  fixtures/               → saved Sleeper JSON from a real week
  stats.test.ts
  lint-report.test.ts
.github/workflows/
  ci.yml                  → test + check + build + audit on PRs
  weekly-report.yml       → Tue 15:00 UTC: draft report, lint, open PR
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

- **Always:** Keep Sleeper fetches at build time. Run `npm test && npm run check` before committing. Pass reports through `lint:report`. Use `writing-style.md` verbatim as the system prompt.
- **Ask first:** Adding any npm dependency. Changing the power ranking formula. Switching the Claude model. Adding client side JS beyond the theme toggle, tabs, and report export buttons. Changing hosting.
- **Never:** Commit API keys or `.env`. Call the Anthropic API from the browser. Auto merge a report PR. Let the model state numbers that aren't in the facts bundle. Render raw HTML from report markdown.

## Success Criteria

- [ ] `npm run build` with the real league ID produces all pages with no errors.
- [ ] Standings match Sleeper's app for the current week.
- [ ] What if diagonal matches actual records for all 12 teams.
- [ ] Lighthouse mobile score ≥ 95 for performance and accessibility on every page.
- [ ] Total JS shipped per page < 5 KB on load. The lazy `html-to-image` chunk doesn't count toward this.
- [ ] "Save PDF" prints a report to a clean 1 to 2 page letter PDF with no nav or buttons, in light colors, from both Chrome and Safari.
- [ ] "Save image" downloads a 1080px wide PNG of the full article from both mobile and desktop.
- [ ] Theme toggle works, persists, and has no flash of the wrong theme on load.
- [ ] `weekly-report.yml` run manually opens a PR with a report that passes `lint:report`.
- [ ] `/history` lists the correct champion for 2024 and 2025 and shows each season's draft board.
- [ ] All time W/L per manager sums correctly across the 10 team and 12 team seasons.
- [ ] CI secret guard fails a build that contains a fake `sk-ant-` string.
- [ ] securityheaders.com grades the deployed site A or better.
- [ ] No horizontal page scroll at 360px width.

## Decisions

- League ID: `1386106937921253376`.
- News source: Sleeper data plus the ESPN NFL RSS feed (`espn.com/espn/rss/nfl/news`). If the feed fails, the report falls back to Sleeper data alone.
- Hyphens: allowed only inside player names that match Sleeper's player list. Banned everywhere else.
- Tone: the report calls out managers by name.
- Power rankings: 50/30/20 weights.
- The punishment loser is the last place team in the regular season standings, not the loser of a bracket.
- History starts at 2024. There are no seasons before Sleeper.
- The trade calculator is cut and not planned.

## Open Questions

1. **Stretch features:** Player values need a source. FantasyCalc has a free public API. Decide when we get there.
