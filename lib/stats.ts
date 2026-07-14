// Server-only recent-form stats for a matchup: each team's last 5 finished
// results, derived from the fixtures snapshot (all World Cup fixtures) plus
// the final scores we already read for live/replay. No dedicated H2H
// endpoint is needed - it is assembled from data the free tier exposes.
//
// Teams are matched on id OR name (the feed isn't always consistent about
// carrying participant ids), and the target matchup can be resolved from the
// passed-in team names when the fixture itself isn't in the snapshot (replay /
// seeded / pinned matches). When the feed has no finished history for a team
// (e.g. the always-on seeded demo), a curated last-5 keeps the card populated.

import { txlineGet } from "@/lib/txline";
import { getScoresSnapshot } from "@/lib/scores-snapshot";
import { foldScores } from "@/lib/txline-parse";
import { isFinal } from "@/lib/game-core";
import { getSeedForm } from "@/lib/seed-form";

interface RawFixture {
  FixtureId: number;
  StartTime: number;
  Participant1: string;
  Participant2: string;
  Participant1Id?: number;
  Participant2Id?: number;
}

export interface FormResult {
  opponent: string;
  home: boolean; // was this team at home in that fixture
  score: string; // "2-1" from this team's perspective
  result: "W" | "D" | "L";
  startTime: number;
}

export interface TeamForm {
  name: string;
  form: FormResult[]; // newest first, up to RECENT_COUNT
  summary: string; // e.g. "3W-1D-1L" or "No recent matches"
}

export interface MatchStats {
  fixtureId: number;
  home: TeamForm;
  away: TeamForm;
}

/** How the caller can name the matchup when the fixture isn't in the snapshot. */
export interface MatchHint {
  home?: string;
  away?: string;
}

const RECENT_COUNT = 5;
const cache = new Map<number, { at: number; stats: MatchStats }>();
const CACHE_TTL_MS = 5 * 60_000; // finished results don't change

/** A team's identity: an id when the feed carries one, plus its name. */
interface TeamId {
  id?: number;
  name: string;
}

const normName = (s: string) => s.trim().toLowerCase();

/**
 * Whether two team references are the same side. Ids win when both are present
 * and equal; otherwise fall back to a normalised name match - so an id on one
 * fixture and a bare name on another (a real feed inconsistency) still link up.
 */
function sameTeam(a: TeamId, b: TeamId): boolean {
  if (a.id != null && b.id != null && a.id === b.id) return true;
  return normName(a.name) === normName(b.name);
}

function sideId(f: RawFixture, side: 1 | 2): TeamId {
  return side === 1
    ? { id: f.Participant1Id, name: f.Participant1 }
    : { id: f.Participant2Id, name: f.Participant2 };
}

/** Does this fixture involve the given team on either side? */
function involves(f: RawFixture, team: TeamId): boolean {
  return sameTeam(sideId(f, 1), team) || sameTeam(sideId(f, 2), team);
}

/**
 * Final score for a finished fixture, or null if it isn't final / unknown.
 * The live snapshot only covers matches that are live or just finished; older
 * finished fixtures (the norm for "last 5 games") live ONLY in the historical
 * feed, so fall back to that - this is why recent form used to come back empty.
 */
async function finalScore(
  fixtureId: number,
): Promise<{ home: number; away: number } | null> {
  try {
    const folded = foldScores(await getScoresSnapshot(fixtureId));
    if (folded.score && isFinal(folded.statusId)) return folded.score;
  } catch {
    /* fall through to the historical feed */
  }
  try {
    const folded = foldScores(await txlineGet(`/scores/historical/${fixtureId}`));
    if (folded.score && isFinal(folded.statusId)) return folded.score;
  } catch {
    /* no history for this fixture: skip it */
  }
  return null;
}

/** Curated last-5 for a team when the live feed has nothing (seeded/demo). */
function seededForm(name: string): TeamForm | null {
  const seed = getSeedForm(name);
  if (!seed || seed.length === 0) return null;
  const now = Date.now();
  const form: FormResult[] = seed.slice(0, RECENT_COUNT).map((e) => ({
    opponent: e.opponent,
    home: e.home,
    score: e.score,
    result: e.result,
    startTime: now - e.daysAgo * 24 * 3600_000,
  }));
  return { name, form, summary: summarise(form) };
}

function summarise(form: FormResult[]): string {
  if (form.length === 0) return "No recent matches";
  const w = form.filter((r) => r.result === "W").length;
  const d = form.filter((r) => r.result === "D").length;
  const l = form.filter((r) => r.result === "L").length;
  return [w ? `${w}W` : "", d ? `${d}D` : "", l ? `${l}L` : ""].filter(Boolean).join("-");
}

function buildTeamForm(
  team: TeamId,
  candidates: RawFixture[],
  scores: Map<number, { home: number; away: number }>,
): TeamForm {
  const mine = candidates
    .filter((f) => involves(f, team))
    .sort((a, b) => b.StartTime - a.StartTime);

  const form: FormResult[] = [];
  for (const f of mine) {
    if (form.length >= RECENT_COUNT) break;
    const score = scores.get(f.FixtureId);
    if (!score) continue;
    const isHome = sameTeam(sideId(f, 1), team);
    const mineGoals = isHome ? score.home : score.away;
    const oppGoals = isHome ? score.away : score.home;
    form.push({
      opponent: isHome ? f.Participant2 : f.Participant1,
      home: isHome,
      score: `${mineGoals}-${oppGoals}`,
      result: mineGoals > oppGoals ? "W" : mineGoals < oppGoals ? "L" : "D",
      startTime: f.StartTime,
    });
  }

  // No finished history in the feed (e.g. the seeded demo): fall back to the
  // curated last-5 so the card is never empty for a showcase side.
  if (form.length === 0) {
    const seeded = seededForm(team.name);
    if (seeded) return seeded;
  }

  return { name: team.name, form, summary: summarise(form) };
}

export async function getMatchStats(
  fixtureId: number,
  hint?: MatchHint,
): Promise<MatchStats> {
  const hit = cache.get(fixtureId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stats;

  let fixtures: RawFixture[] = [];
  try {
    const raw = await txlineGet<RawFixture[]>("/fixtures/snapshot");
    fixtures = Array.isArray(raw) ? raw : [];
  } catch {
    // The schedule feed is down; we can still show curated form from the hint.
    fixtures = [];
  }
  const now = Date.now();

  // Resolve the two sides: prefer the real fixture, else the caller's names.
  const target = fixtures.find((f) => f.FixtureId === fixtureId);
  let homeTeam: TeamId;
  let awayTeam: TeamId;
  if (target) {
    homeTeam = sideId(target, 1);
    awayTeam = sideId(target, 2);
  } else if (hint?.home && hint?.away) {
    homeTeam = { name: hint.home };
    awayTeam = { name: hint.away };
  } else {
    throw new Error("Fixture not found in the schedule.");
  }

  // Past fixtures involving either team (kicked off already, not this one),
  // newest first. Cap the set so we make a bounded number of score fetches.
  const candidates = fixtures
    .filter(
      (f) =>
        f.FixtureId !== fixtureId &&
        f.StartTime < now &&
        (involves(f, homeTeam) || involves(f, awayTeam)),
    )
    .sort((a, b) => b.StartTime - a.StartTime)
    .slice(0, RECENT_COUNT * 6); // enough to cover 5 each, both teams

  // Fetch all candidate final scores in parallel (scores only, no odds).
  const scoreEntries = await Promise.all(
    candidates.map(async (f) => [f.FixtureId, await finalScore(f.FixtureId)] as const),
  );
  const scores = new Map<number, { home: number; away: number }>();
  for (const [id, score] of scoreEntries) if (score) scores.set(id, score);

  const stats: MatchStats = {
    fixtureId,
    home: buildTeamForm(homeTeam, candidates, scores),
    away: buildTeamForm(awayTeam, candidates, scores),
  };
  cache.set(fixtureId, { at: Date.now(), stats });
  return stats;
}
