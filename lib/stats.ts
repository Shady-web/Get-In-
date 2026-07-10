// Server-only recent-form stats for a matchup: each team's last 3 finished
// results, derived from the fixtures snapshot (all World Cup fixtures) plus
// the final scores we already read for live/replay. No dedicated H2H
// endpoint is needed - it is assembled from data the free tier exposes.

import { txlineGet } from "@/lib/txline";
import { getScoresSnapshot } from "@/lib/scores-snapshot";
import { foldScores } from "@/lib/txline-parse";
import { isFinal } from "@/lib/game-core";

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
  form: FormResult[]; // newest first, up to 3
  summary: string; // e.g. "2W-1L" or "No recent matches"
}

export interface MatchStats {
  fixtureId: number;
  home: TeamForm;
  away: TeamForm;
}

const RECENT_COUNT = 3;
const cache = new Map<number, { at: number; stats: MatchStats }>();
const CACHE_TTL_MS = 5 * 60_000; // finished results don't change

/** A team key we can match on: id if present, else the name. */
function teamKey(id: number | undefined, name: string): string {
  return id != null ? `id:${id}` : `name:${name.toLowerCase()}`;
}

function keysForSide(f: RawFixture, side: 1 | 2): string {
  return side === 1
    ? teamKey(f.Participant1Id, f.Participant1)
    : teamKey(f.Participant2Id, f.Participant2);
}

/**
 * Final score for a finished fixture, or null if it isn't final / unknown.
 * The live snapshot only covers matches that are live or just finished; older
 * finished fixtures (the norm for "last 3 games") live ONLY in the historical
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

function buildTeamForm(
  key: string,
  name: string,
  candidates: RawFixture[],
  scores: Map<number, { home: number; away: number }>,
): TeamForm {
  const mine = candidates
    .filter((f) => keysForSide(f, 1) === key || keysForSide(f, 2) === key)
    .sort((a, b) => b.StartTime - a.StartTime);

  const form: FormResult[] = [];
  for (const f of mine) {
    if (form.length >= RECENT_COUNT) break;
    const score = scores.get(f.FixtureId);
    if (!score) continue;
    const isHome = keysForSide(f, 1) === key;
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

  const w = form.filter((r) => r.result === "W").length;
  const d = form.filter((r) => r.result === "D").length;
  const l = form.filter((r) => r.result === "L").length;
  const summary =
    form.length === 0
      ? "No recent matches"
      : [w ? `${w}W` : "", d ? `${d}D` : "", l ? `${l}L` : ""].filter(Boolean).join("-");

  return { name, form, summary };
}

export async function getMatchStats(fixtureId: number): Promise<MatchStats> {
  const hit = cache.get(fixtureId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stats;

  const raw = await txlineGet<RawFixture[]>("/fixtures/snapshot");
  const fixtures = Array.isArray(raw) ? raw : [];
  const now = Date.now();

  const target = fixtures.find((f) => f.FixtureId === fixtureId);
  if (!target) throw new Error("Fixture not found in the schedule.");

  const homeKey = keysForSide(target, 1);
  const awayKey = keysForSide(target, 2);

  // Past fixtures involving either team (kicked off already, not this one),
  // newest first. Cap the set so we make a bounded number of score fetches.
  const involvesEither = (f: RawFixture) =>
    keysForSide(f, 1) === homeKey ||
    keysForSide(f, 2) === homeKey ||
    keysForSide(f, 1) === awayKey ||
    keysForSide(f, 2) === awayKey;
  const candidates = fixtures
    .filter((f) => f.FixtureId !== fixtureId && f.StartTime < now && involvesEither(f))
    .sort((a, b) => b.StartTime - a.StartTime)
    .slice(0, RECENT_COUNT * 4); // enough to cover 3 each, both teams

  // Fetch all candidate final scores in parallel (scores only, no odds).
  const scoreEntries = await Promise.all(
    candidates.map(async (f) => [f.FixtureId, await finalScore(f.FixtureId)] as const),
  );
  const scores = new Map<number, { home: number; away: number }>();
  for (const [id, score] of scoreEntries) if (score) scores.set(id, score);

  const stats: MatchStats = {
    fixtureId,
    home: buildTeamForm(homeKey, target.Participant1, candidates, scores),
    away: buildTeamForm(awayKey, target.Participant2, candidates, scores),
  };
  cache.set(fixtureId, { at: Date.now(), stats });
  return stats;
}
