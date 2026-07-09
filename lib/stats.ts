// Server-only recent-form stats for a matchup: each team's last 3 finished
// results, derived from the fixtures snapshot (all World Cup fixtures) plus
// the final scores we already read for live/replay. No dedicated H2H
// endpoint is needed - it is assembled from data the free tier exposes.

import { txlineGet } from "@/lib/txline";
import { getLiveState } from "@/lib/live";
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

async function buildTeamForm(
  key: string,
  name: string,
  finished: RawFixture[],
  now: number,
): Promise<TeamForm> {
  // This team's finished fixtures, newest first.
  const mine = finished
    .filter((f) => keysForSide(f, 1) === key || keysForSide(f, 2) === key)
    .sort((a, b) => b.StartTime - a.StartTime)
    .slice(0, RECENT_COUNT * 2); // over-fetch: some may lack a usable score

  const form: FormResult[] = [];
  for (const f of mine) {
    if (form.length >= RECENT_COUNT) break;
    let state;
    try {
      state = await getLiveState(f.FixtureId);
    } catch {
      continue;
    }
    if (!state.score || !isFinal(state.statusId)) continue;

    const isHome = keysForSide(f, 1) === key;
    const mineGoals = isHome ? state.score.home : state.score.away;
    const oppGoals = isHome ? state.score.away : state.score.home;
    const opponent = isHome ? f.Participant2 : f.Participant1;
    form.push({
      opponent,
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
      ? "No recent matches yet"
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

  // Candidate past matches: kicked off already and not this fixture.
  const finished = fixtures.filter((f) => f.FixtureId !== fixtureId && f.StartTime < now);

  const [home, away] = await Promise.all([
    buildTeamForm(keysForSide(target, 1), target.Participant1, finished, now),
    buildTeamForm(keysForSide(target, 2), target.Participant2, finished, now),
  ]);

  const stats: MatchStats = { fixtureId, home, away };
  cache.set(fixtureId, { at: Date.now(), stats });
  return stats;
}
