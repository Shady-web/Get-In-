// Pure replay types + state synthesis, shared by server and browser.
// The browser plays back the timeline locally for buttery scrubbing; the
// server uses the same function to validate picks and settle at a given
// virtual time. No fetch/env access here.

import type { LiveState } from "@/lib/live";

export interface ScoreFrame {
  t: number; // match clock seconds
  ts: number; // wall-clock ms (for mapping odds onto the clock)
  score: { home: number; away: number };
  corners: number;
  red?: { home: number; away: number }; // red cards so far (missing = 0-0)
  statusId: string | null;
}

export interface OddsFrame {
  t: number; // match clock seconds (mapped from Ts)
  prob: { home: number; draw: number; away: number };
  odds: { home: number; draw: number; away: number };
  bookmaker: string | null;
}

export interface ReplayTimeline {
  fixtureId: number;
  duration: number; // last known clock second
  scoreFrames: ScoreFrame[]; // sorted by t
  oddsFrames: OddsFrame[]; // sorted by t
}

export const REPLAY_PHASE_LABELS: Record<string, string> = {
  NS: "Kickoff soon",
  H1: "1st half",
  HT: "Half-time",
  H2: "2nd half",
  WET: "Waiting extra time",
  ET1: "Extra time 1",
  HTET: "ET break",
  ET2: "Extra time 2",
  WPE: "Waiting penalties",
  PE: "Penalties",
  F: "Full time",
  FET: "Full time (AET)",
  FPE: "Full time (pens)",
  I: "Interrupted",
};

/** Synthesize the LiveState as it looked at virtual clock second vt. */
export function stateAt(timeline: ReplayTimeline, vt: number): LiveState {
  let s: ScoreFrame | null = null;
  for (const f of timeline.scoreFrames) {
    if (f.t <= vt) s = f;
    else break;
  }
  let o: OddsFrame | null = null;
  for (const f of timeline.oddsFrames) {
    if (f.t <= vt) o = f;
    else break;
  }

  // Statuses in the frame apply from that frame onward; before the first
  // frame the match hasn't started.
  const statusId = s?.statusId ?? "NS";
  const ended = vt >= timeline.duration;

  return {
    fixtureId: timeline.fixtureId,
    score: s?.score ?? { home: 0, away: 0 },
    statusId: ended ? (statusId === "H2" || statusId === "ET2" ? "F" : statusId) : statusId,
    phase: REPLAY_PHASE_LABELS[ended ? "F" : statusId] ?? "In play",
    clockSeconds: Math.min(vt, timeline.duration),
    clockRunning: !ended,
    corners: s?.corners ?? 0,
    prob: o?.prob ?? null,
    odds: o?.odds ?? null,
    bookmaker: o?.bookmaker ?? null,
    fetchedAt: Date.now(),
  };
}
