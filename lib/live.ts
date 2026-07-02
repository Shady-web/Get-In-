// Server-only live match state: polls TxLINE scores + odds snapshots and
// normalizes them into one small payload for the UI. A module-level cache
// (TTL ~6.5s) means TxLINE gets hit at most every ~7 seconds per fixture,
// no matter how many browsers are polling us.

import { txlineGet } from "@/lib/txline";

export interface LiveState {
  fixtureId: number;
  score: { home: number; away: number } | null;
  phase: string; // human label: "1st half", "HT", "FT", ...
  statusId: string | null; // raw TxLINE status: NS/H1/HT/H2/F/...
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

// --- Scores normalization ---------------------------------------------------

/** statusSoccerId serializes as "H1" or {"H1": {}} - accept both. */
function statusToString(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw as object);
    if (keys.length > 0) return keys[0];
  }
  return null;
}

const PHASE_LABELS: Record<string, string> = {
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
};

interface ParsedScores {
  score: { home: number; away: number } | null;
  statusId: string | null;
  clockSeconds: number | null;
  clockRunning: boolean;
  corners: number | null;
}

function parseScores(raw: unknown): ParsedScores {
  const out: ParsedScores = {
    score: null,
    statusId: null,
    clockSeconds: null,
    clockRunning: false,
    corners: null,
  };
  if (!Array.isArray(raw)) return out;

  for (const entry of raw) {
    // Stream-style events wrap the payload in .data; snapshots are bare.
    const u = (entry as any)?.data ?? entry;
    if (!u || typeof u !== "object") continue;

    const status = statusToString(u.statusSoccerId);
    if (status) out.statusId = status;

    const clock = u.clock;
    if (clock && typeof clock.seconds === "number") {
      out.clockSeconds = clock.seconds;
      out.clockRunning = Boolean(clock.running);
    }

    const goals1 = u.scoreSoccer?.Participant1?.Total?.Goals;
    const goals2 = u.scoreSoccer?.Participant2?.Total?.Goals;
    if (typeof goals1 === "number" && typeof goals2 === "number") {
      out.score = { home: goals1, away: goals2 };
    }

    const c1 = u.scoreSoccer?.Participant1?.Total?.Corners;
    const c2 = u.scoreSoccer?.Participant2?.Total?.Corners;
    if (typeof c1 === "number" && typeof c2 === "number") {
      out.corners = c1 + c2;
    }
  }
  return out;
}

// --- Odds normalization -------------------------------------------------------

const HOME_NAMES = new Set(["1", "home", "h"]);
const DRAW_NAMES = new Set(["x", "draw", "d"]);
const AWAY_NAMES = new Set(["2", "away", "a"]);

interface ParsedOdds {
  prob: { home: number; draw: number; away: number } | null;
  odds: { home: number; draw: number; away: number } | null;
  bookmaker: string | null;
}

const NO_ODDS: ParsedOdds = { prob: null, odds: null, bookmaker: null };

function parseOdds(raw: unknown): ParsedOdds {
  if (!Array.isArray(raw)) return NO_ODDS;

  // Latest 3-way (1X2) payload wins; prefer full-time-looking markets.
  let best: any = null;
  for (const entry of raw) {
    const p = (entry as any)?.data ?? entry;
    if (!p || !Array.isArray(p.PriceNames) || p.PriceNames.length !== 3) continue;
    const period = String(p.MarketPeriod ?? "").toLowerCase();
    const isFullTime = period === "" || period === "ft" || period.includes("full");
    if (!isFullTime) continue;
    if (!best || (p.Ts ?? 0) >= (best.Ts ?? 0)) best = p;
  }
  if (!best) return NO_ODDS;

  // Map outcomes by name; fall back to positional [home, draw, away].
  const idx = { home: 0, draw: 1, away: 2 };
  best.PriceNames.forEach((name: unknown, i: number) => {
    const n = String(name ?? "").toLowerCase();
    if (HOME_NAMES.has(n)) idx.home = i;
    else if (DRAW_NAMES.has(n)) idx.draw = i;
    else if (AWAY_NAMES.has(n)) idx.away = i;
  });

  // Pct = implied percentages ("52.632"); preferred over raw prices.
  let implied: number[] | null = null;
  if (Array.isArray(best.Pct) && best.Pct.length === 3) {
    const vals = best.Pct.map((s: unknown) => Number.parseFloat(String(s)));
    if (vals.every((v: number) => Number.isFinite(v) && v > 0)) implied = vals;
  }
  if (!implied && Array.isArray(best.Prices) && best.Prices.length === 3) {
    // Prices are decimal odds ×1000 (e.g. 1900 = 1.90) → implied = 1/odds.
    const vals = best.Prices.map((p: unknown) => {
      const odds = Number(p) / 1000;
      return odds > 1 ? 100 / odds : NaN;
    });
    if (vals.every((v: number) => Number.isFinite(v) && v > 0)) implied = vals;
  }
  if (!implied) return { prob: null, odds: null, bookmaker: best.Bookmaker ?? null };

  // Normalize away the bookmaker margin so the three sum to 100.
  const sum = implied[0] + implied[1] + implied[2];
  const pct = (i: number) => Math.round((implied![i] / sum) * 1000) / 10;
  const home = pct(idx.home);
  const draw = pct(idx.draw);
  const away = Math.round((100 - home - draw) * 10) / 10;

  // Decimal odds: real book prices when sane (int32, x1000), else fair odds
  // reconstructed from the implied percentages.
  const decimal = (i: number): number => {
    const p = Array.isArray(best.Prices) ? Number(best.Prices[i]) : NaN;
    if (Number.isFinite(p) && p >= 1010 && p <= 1_000_000) {
      return Math.round(p) / 1000;
    }
    return Math.round((100 / implied![i]) * 100) / 100;
  };

  return {
    prob: { home, draw, away },
    odds: { home: decimal(idx.home), draw: decimal(idx.draw), away: decimal(idx.away) },
    bookmaker: best.Bookmaker ?? null,
  };
}

// --- Public API -----------------------------------------------------------------

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

  const s = parseScores(scoresRaw.status === "fulfilled" ? scoresRaw.value : null);
  const o = parseOdds(oddsRaw.status === "fulfilled" ? oddsRaw.value : null);

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
