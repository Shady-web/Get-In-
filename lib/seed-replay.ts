// A bundled, always-available replay so Replay Mode is never empty — judges
// can open the app at any time and always have a full match to watch and bet
// on, even if the live feed has nothing finished in range or is unreachable.
//
// This is a self-contained ReplayTimeline (score frames + odds movement +
// goal/card events). It is served by getReplayTimeline for its pinned id and
// always listed in the replay list, so full markets, odds movement, betting
// and settlement all work against it exactly like a real replay.

import type { MatchEvent, OddsFrame, ReplayTimeline, ScoreFrame } from "@/lib/replay-core";

/** Pinned fixture id for the seeded France v Spain final. */
export const SEED_FIXTURE_ID = 900719;

/**
 * Real fixture ids to pin on top of Replay Mode, set via the env var
 * NEXT_PUBLIC_PINNED_REPLAY_IDS (comma-separated). Once the real France–Spain
 * has finished, put its fixture id here (env change + redeploy, no code
 * change): the real replay then takes over and the demo seed is hidden. Until
 * a pinned real match is actually finished, the demo stays so Replay Mode is
 * never empty. NEXT_PUBLIC_ so both the server and the browser read the same
 * value.
 */
export const PINNED_REPLAY_IDS: number[] = (process.env.NEXT_PUBLIC_PINNED_REPLAY_IDS ?? "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

// Fixed kickoff (2026-07-19, the final) so it always reads as a past match.
const SEED_START = Date.UTC(2026, 6, 19, 19, 0, 0);

const HOME = "France";
const AWAY = "Spain";

// [minute, score, corners, redAway, prob home/draw/away]
const SCRIPT: Array<{
  m: number;
  status: string;
  h: number;
  a: number;
  ch: number;
  ca: number;
  ra: number;
  ya: number;
  yh: number;
  prob: [number, number, number];
}> = [
  { m: 0, status: "H1", h: 0, a: 0, ch: 0, ca: 0, ra: 0, ya: 0, yh: 0, prob: [42, 30, 28] },
  { m: 12, status: "H1", h: 0, a: 0, ch: 2, ca: 1, ra: 0, ya: 0, yh: 0, prob: [45, 29, 26] },
  { m: 23, status: "H1", h: 1, a: 0, ch: 3, ca: 1, ra: 0, ya: 0, yh: 0, prob: [58, 24, 18] },
  { m: 45, status: "HT", h: 1, a: 0, ch: 4, ca: 2, ra: 0, ya: 0, yh: 0, prob: [60, 23, 17] },
  { m: 46, status: "H2", h: 1, a: 0, ch: 4, ca: 2, ra: 0, ya: 0, yh: 0, prob: [60, 23, 17] },
  { m: 51, status: "H2", h: 1, a: 1, ch: 4, ca: 3, ra: 0, ya: 0, yh: 0, prob: [40, 30, 30] },
  { m: 65, status: "H2", h: 1, a: 1, ch: 5, ca: 4, ra: 0, ya: 0, yh: 1, prob: [43, 30, 27] },
  { m: 78, status: "H2", h: 2, a: 1, ch: 6, ca: 5, ra: 0, ya: 0, yh: 1, prob: [72, 18, 10] },
  { m: 84, status: "H2", h: 2, a: 1, ch: 6, ca: 5, ra: 1, ya: 1, yh: 1, prob: [82, 12, 6] },
  { m: 92, status: "F", h: 2, a: 1, ch: 7, ca: 5, ra: 1, ya: 1, yh: 1, prob: [88, 8, 4] },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Decimal odds from an implied percentage, with a light margin. */
const oddsFromPct = (pct: number) => round2(Math.max(1.05, (100 / Math.max(1, pct)) * 0.97));

function buildTimeline(): ReplayTimeline {
  const scoreFrames: ScoreFrame[] = SCRIPT.map((s) => ({
    t: s.m * 60,
    ts: SEED_START + s.m * 60_000,
    score: { home: s.h, away: s.a },
    corners: s.ch + s.ca,
    red: { home: 0, away: s.ra },
    yellow: { home: s.yh, away: s.ya },
    statusId: s.status,
  }));

  const oddsFrames: OddsFrame[] = SCRIPT.map((s) => {
    const [ph, pd, pa] = s.prob;
    return {
      t: s.m * 60,
      prob: { home: ph, draw: pd, away: pa },
      odds: { home: oddsFromPct(ph), draw: oddsFromPct(pd), away: oddsFromPct(pa) },
      bookmaker: "GetIN",
    };
  });

  const events: MatchEvent[] = [
    { t: 23 * 60, minute: 23, team: "home", kind: "goal", player: "K. Mbappé" },
    { t: 51 * 60, minute: 51, team: "away", kind: "goal", player: "Á. Morata" },
    { t: 65 * 60, minute: 65, team: "home", kind: "yellow", player: "A. Griezmann" },
    { t: 78 * 60, minute: 78, team: "home", kind: "goal", player: "O. Dembélé" },
    { t: 84 * 60, minute: 84, team: "away", kind: "red", player: "P. Torres" },
  ];

  return {
    fixtureId: SEED_FIXTURE_ID,
    duration: 92 * 60,
    scoreFrames,
    oddsFrames,
    events,
  };
}

const SEED_TIMELINES: Record<number, ReplayTimeline> = {
  [SEED_FIXTURE_ID]: buildTimeline(),
};

/** The seeded timeline for a pinned fixture id, or null if not seeded. */
export function getSeedReplay(fixtureId: number): ReplayTimeline | null {
  return SEED_TIMELINES[fixtureId] ?? null;
}

/** Fixture-list entries for the pinned replays (always shown as finished). */
export const SEED_REPLAY_FIXTURES = [
  {
    FixtureId: SEED_FIXTURE_ID,
    Participant1: HOME,
    Participant2: AWAY,
    Participant1IsHome: true,
    StartTime: SEED_START,
    Competition: "World Cup",
    CompetitionId: 72,
    LiveStatus: "finished" as const,
    LiveScore: { home: 2, away: 1 },
  },
];
