// League history across seasons. Managers are tracked by Sleeper user_id because roster ids reset each season.
import { calls, currentLeagueId, leagueById, loadSeason, winnersBracket, type League, type Season } from './sleeper.ts';
import { games, result, standings, teamNames, type Record3 } from './stats.ts';

export interface BracketMatch {
  r: number;
  m: number;
  t1?: number | null;
  t2?: number | null;
  w: number | null;
  l: number | null;
  p?: number;
}

/** A season plus its winners bracket (null while the season is in progress). */
export interface SeasonData extends Season {
  bracket: BracketMatch[] | null;
}

/** Follows previous_league_id back, newest first. Stops on a repeated id or after `max` seasons. */
export async function walkChain(startId: string, fetchLeague: (id: string) => Promise<League>, max = 30): Promise<League[]> {
  const out: League[] = [];
  const seen = new Set<string>();
  for (let id: string | null = startId; id && id !== '0' && !seen.has(id) && out.length < max; ) {
    seen.add(id);
    const league = await fetchLeague(id);
    out.push(league);
    id = league.previous_league_id;
  }
  return out;
}

let logged = false;

export async function loadHistory(startId = currentLeagueId()): Promise<SeasonData[]> {
  const leagues = await walkChain(startId, leagueById);
  const seasons = await Promise.all(leagues.map(async l => ({
    ...(await loadSeason(l.league_id)),
    bracket: l.status === 'complete' ? await winnersBracket(l.league_id) : null,
  })));
  // Once per build: shows whether completed seasons came from the disk cache.
  if (!logged) console.log(`sleeper: ${calls.live} live, ${calls.cached} cached`);
  logged = true;
  return seasons;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (r: Record3) => (r.w + r.l + r.t ? (r.w + r.t / 2) / (r.w + r.l + r.t) : 0);
const longestRun = (record: string, c: string) => Math.max(0, ...[...record.matchAll(new RegExp(`${c}+`, 'g'))].map(m => m[0].length));

export function buildHistory(seasons: SeasonData[]) {
  // Newest season first, so the first name found for a manager is their current one.
  const ordered = [...seasons].sort((a, b) => Number(b.league.season) - Number(a.league.season));
  const names = new Map<string, { name: string; team: string }>();
  for (const s of ordered) for (const r of s.rosters) {
    if (!names.has(r.owner_id)) {
      const t = teamNames(s.users, r.owner_id);
      names.set(r.owner_id, { name: t.manager, team: t.team });
    }
  }
  const person = (userId: string) => ({ userId, ...names.get(userId)! });

  const managers = new Map<string, { seasons: number; w: number; l: number; t: number; pf: number; playoffs: number; titles: number; punishments: number }>();
  const m = (id: string) => {
    if (!managers.has(id)) managers.set(id, { seasons: 0, w: 0, l: 0, t: 0, pf: 0, playoffs: 0, titles: 0, punishments: 0 });
    return managers.get(id)!;
  };
  const h2h: Record<string, Record<string, Record3>> = {};
  const allGames: { season: number; week: number; userId: string; oppId: string; points: number; opp: number }[] = [];
  const seasonRows: { season: number; userId: string; w: number; l: number; t: number; pf: number; record: string; inProgress: boolean }[] = [];

  const summaries = ordered.map(s => {
    const season = Number(s.league.season);
    const owner = (rosterId: number) => s.rosters.find(r => r.roster_id === rosterId)!.owner_id;
    const g = games(s.weeks);
    const rows = standings(s.rosters, s.users, g);
    const inProgress = s.bracket === null;

    for (const row of rows) {
      const id = owner(row.rosterId);
      const x = m(id);
      x.seasons++; x.w += row.w; x.l += row.l; x.t += row.t; x.pf = round2(x.pf + row.pf);
      seasonRows.push({ season, userId: id, w: row.w, l: row.l, t: row.t, pf: row.pf, record: row.record, inProgress });
    }
    for (const game of g) {
      const [a, b] = [owner(game.rosterId), owner(game.opponentId)];
      const cell = ((h2h[a] ??= {})[b] ??= { w: 0, l: 0, t: 0 });
      const r = result(game);
      cell[r === 'W' ? 'w' : r === 'L' ? 'l' : 't']++;
      allGames.push({ season, week: game.week, userId: a, oppId: b, points: game.points, opp: game.opponentPoints });
    }

    const final = s.bracket?.find(x => x.p === 1);
    const playoffRosters = new Set((s.bracket ?? []).flatMap(x => [x.t1, x.t2]).filter((x): x is number => typeof x === 'number'));
    for (const rid of playoffRosters) m(owner(rid)).playoffs++;
    const champion = final?.w ? person(owner(final.w)) : null;
    const runnerUp = final?.l ? person(owner(final.l)) : null;
    const punishment = inProgress ? null : person(owner(rows.at(-1)!.rosterId));
    if (champion) m(champion.userId).titles++;
    if (punishment) m(punishment.userId).punishments++;

    return {
      season,
      leagueId: s.league.league_id,
      teams: s.league.total_rosters,
      inProgress,
      champion,
      runnerUp,
      punishment,
      standings: rows.map(r => ({ ...person(owner(r.rosterId)), team: r.team, rank: r.rank, w: r.w, l: r.l, t: r.t, pf: r.pf, pa: r.pa })),
    };
  });

  const byPoints = (sign: 1 | -1) => allGames.reduce((a, b) => (sign * (b.points - a.points) > 0 ? b : a));
  const high = byPoints(1);
  const low = byPoints(-1);
  const blow = allGames.filter(x => x.points > x.opp).reduce((a, b) => (b.points - b.opp > a.points - a.opp ? b : a));
  const done = seasonRows.filter(r => !r.inProgress);
  const rank = (a: Record3 & { pf: number }, b: Record3 & { pf: number }) => pct(b) - pct(a) || b.pf - a.pf;
  const best = [...done].sort(rank)[0]!;
  const worst = [...done].sort(rank).at(-1)!;
  const streak = (c: 'W' | 'L') => seasonRows.map(r => ({ n: longestRun(r.record, c), ...person(r.userId), season: r.season })).reduce((a, b) => (b.n > a.n ? b : a));

  return {
    seasons: summaries,
    managers: [...managers].map(([userId, x]) => ({ ...person(userId), ...x, pct: Math.round(pct(x) * 1000) / 1000 }))
      .sort((a, b) => b.titles - a.titles || b.pct - a.pct || b.pf - a.pf),
    h2h,
    records: {
      highScore: { value: high.points, ...person(high.userId), season: high.season, week: high.week },
      lowScore: { value: low.points, ...person(low.userId), season: low.season, week: low.week },
      blowout: { margin: round2(blow.points - blow.opp), winner: person(blow.userId), loser: person(blow.oppId), season: blow.season, week: blow.week },
      bestSeason: { ...person(best.userId), season: best.season, w: best.w, l: best.l, t: best.t, pf: best.pf },
      worstSeason: { ...person(worst.userId), season: worst.season, w: worst.w, l: worst.l, t: worst.t, pf: worst.pf },
      longestWinStreak: streak('W'),
      longestLosingStreak: streak('L'),
    },
  };
}

export interface DraftPick {
  round: number;
  pick_no: number;
  draft_slot: number;
  roster_id: number;
  player_id: string;
  metadata: { first_name?: string | null; last_name?: string | null; position?: string | null; team?: string | null };
}

const pickName = (p: DraftPick) => `${p.metadata.first_name ?? ''} ${p.metadata.last_name ?? ''}`.trim() || p.player_id;

/** Rounds (rows) by draft slots (columns). `team` names the roster that picks from each slot. */
export function draftBoard(picks: DraftPick[], team: (rosterId: number) => string) {
  const slotCount = Math.max(...picks.map(p => p.draft_slot));
  const roundCount = Math.max(...picks.map(p => p.round));
  const slots = Array.from({ length: slotCount }, (_, i) => {
    const p = picks.find(x => x.round === 1 && x.draft_slot === i + 1);
    return p ? team(p.roster_id) : `Slot ${i + 1}`;
  });
  const rounds = Array.from({ length: roundCount }, (_, r) =>
    Array.from({ length: slotCount }, (_, s) => {
      const p = picks.find(x => x.round === r + 1 && x.draft_slot === s + 1);
      // label: round.pick within the round, like 3.11.
      const inRound = p ? ((p.pick_no - 1) % slotCount) + 1 : 0;
      return { pickNo: p?.pick_no ?? 0, playerId: p?.player_id ?? '', label: p ? `${p.round}.${String(inRound).padStart(2, '0')}` : '', name: p ? pickName(p) : '', pos: p?.metadata.position ?? '', nflTeam: p?.metadata.team ?? '' };
    }),
  );
  // Direction from the data, not assumed: a snake reverses each round, other formats may not.
  const directions = rounds.map(row => ((row[0]?.pickNo ?? 0) <= (row.at(-1)?.pickNo ?? 0) ? 'ltr' : 'rtl') as 'ltr' | 'rtl');
  return { slots, rounds, directions };
}

/**
 * Draft value, judged within each position: posPick is the order a player was taken among his position
 * (QB 20 = 20th QB drafted), posFinish is where he finished in points among drafted players at that position.
 * diff = posPick - posFinish, so positive means he outplayed the pick. Points come from players_points,
 * so only weeks on a roster in this league count.
 */
export function draftValue(picks: DraftPick[], weeks: { players_points?: Record<string, number> }[][]) {
  const points = new Map<string, number>();
  for (const m of weeks.flat()) for (const [id, pts] of Object.entries(m.players_points ?? {})) points.set(id, (points.get(id) ?? 0) + pts);
  const base = picks.map(p => ({ pickNo: p.pick_no, round: p.round, rosterId: p.roster_id, name: pickName(p), pos: p.metadata.position ?? '', points: round2(points.get(p.player_id) ?? 0) }));
  const all = base.map(x => {
    const samePos = base.filter(y => y.pos === x.pos);
    const posPick = samePos.filter(y => y.pickNo < x.pickNo).length + 1;
    const posFinish = [...samePos].sort((a, b) => b.points - a.points || a.pickNo - b.pickNo).indexOf(x) + 1;
    return { ...x, posPick, posFinish, diff: posPick - posFinish };
  });
  return {
    all,
    hits: [...all].sort((a, b) => b.diff - a.diff || b.points - a.points).slice(0, 5),
    busts: [...all].sort((a, b) => a.diff - b.diff || a.points - b.points).slice(0, 5),
  };
}

/** Winners bracket grouped by round, with team names. place: 1 = final, 3 = third place game, and so on. */
export function playoffRounds(bracket: BracketMatch[], team: (rosterId: number) => string) {
  const name = (id: number | null | undefined) => (typeof id === 'number' ? team(id) : 'TBD');
  const rounds = [...new Set(bracket.map(m => m.r))].sort((a, b) => a - b);
  return rounds.map(round => ({
    round,
    matches: bracket.filter(m => m.r === round).sort((a, b) => (a.p ?? 99) - (b.p ?? 99) || a.m - b.m).map(m => ({
      place: m.p ?? null,
      teams: [name(m.t1), name(m.t2)],
      winner: m.w ? team(m.w) : null,
      loser: m.l ? team(m.l) : null,
    })),
  }));
}
