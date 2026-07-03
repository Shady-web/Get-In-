// Server-only live match state: polls TxLINE scores + odds snapshots and
// normalizes them into one small payload for the UI. A module-level cache
// (TTL ~6.5s) means TxLINE gets hit at most every ~7 seconds per fixture,
// no matter how many browsers are polling us.
//
// Payload parsing lives in lib/txline-parse.ts, matched to the REAL feed
// shapes (verified against production data), not just the published spec.

import { txlineGet } from "@/lib/txline";
import {
  foldScores,
  latest1X2,
  parseMatchOddsPayload,
  NO_MATCH_ODDS,
} from "@/lib/txline-parse";

export interface LiveState {
  fixtureId: number;
  score: { home: number; away: number } | null;
  phase: string; // human label: "1st half", "HT", "FT", ...
  statusId: string | null; // status code: NS/H1/HT/H2/ET1/PE/F/...
  clockSeconds: number | null;
  clockRunning: boolean;
  corners: number | null; // total corners so far, both teams
  prob: { home: number; draw: number; away: number } | null; // percents, sum 100
  odds: { home: number; draw: number; away: number } | null; // decimal odds
  bookmaker: string | null;
  fetchedAt: number; // ms epoch, when we read TxLINE
}

const CACHE_TTL_MS = 6_500;
const cache = new Map<number, { at: number; state: LiveState }>();

export const PHASE_LABELS: Record<string, string> = {
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
  P: "Postponed",
  A: "Abandoned",
  C: "Cancelled",
  TXCC: "Coverage cancelled",
  TXCS: "Coverage suspended",
};

export async function getLiveState(fixtureId: number): Promise<LiveState> {
  const hit = cache.get(fixtureId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.state;

  const [scoresRaw, oddsRaw] = await Promise.allSettled([
    txlineGet(`/scores/snapshot/${fixtureId}`),
    txlineGet(`/odds/snapshot/${fixtureId}`),
  ]);

  // A fixture can have scores before odds (or vice versa) - one failing
  // shouldn't blank the other. Both failing is a real error.
  if (scoresRaw.status === "rejected" && oddsRaw.status === "rejected") {
    throw new Error(
      `TxLINE unreachable for fixture ${fixtureId}: ${scoresRaw.reason?.message ?? scoresRaw.reason}`,
    );
  }

  const s = foldScores(scoresRaw.status === "fulfilled" ? scoresRaw.value : null);
  const payload = latest1X2(oddsRaw.status === "fulfilled" ? oddsRaw.value : null);
  const o = payload ? parseMatchOddsPayload(payload) : NO_MATCH_ODDS;

  const state: LiveState = {
    fixtureId,
    score: s.score,
    statusId: s.statusId,
    phase: PHASE_LABELS[s.statusId ?? ""] ?? (s.score ? "In play" : "Kickoff soon"),
    clockSeconds: s.clockSeconds,
    clockRunning: s.clockRunning,
    corners: s.corners,
    prob: o.prob,
    odds: o.odds,
    bookmaker: o.bookmaker,
    fetchedAt: Date.now(),
  };

  cache.set(fixtureId, { at: Date.now(), state });
  return state;
}
