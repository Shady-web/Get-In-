// Pure prediction-game logic, shared by server AND browser (the replay
// engine builds cards client-side from the same code, so live and replay
// behave identically). No env access, no Supabase, no fetch in here.

import type { LiveState } from "@/lib/live";

export const ROUND_SECONDS = 60;

export type QuestionKind = "result" | "nextgoal" | "corner";

export interface GameOption {
  id: string; // "home" | "draw" | "away" | "yes" | "no"
  label: string;
  odds: number; // decimal odds backing this option
  points: number; // round(odds * 10)
}

export interface GameCard {
  fixtureId: number;
  round: number;
  kind: QuestionKind;
  question: string;
  options: GameOption[];
  // Snapshot the settlement needs later:
  baseline: {
    goals: number;
    corners: number;
    clockSeconds: number;
    deadlineSeconds: number | null; // null settles at full time
  };
}

export interface SettledResult {
  question: string;
  choice: string;
  result: "won" | "lost";
  points: number;
}

const FINAL_STATUSES = new Set(["F", "FET", "FPE", "A", "C"]);

export function isFinal(statusId: string | null): boolean {
  return statusId !== null && FINAL_STATUSES.has(statusId);
}

export const toPoints = (odds: number) => Math.max(10, Math.round(odds * 10));

const opt = (id: string, label: string, odds: number): GameOption => ({
  id,
  label,
  odds: Math.round(odds * 100) / 100,
  points: toPoints(odds),
});

/** The pre-kickoff round: pick the winner before the match starts. */
export const PREMATCH_ROUND = -1;

/**
 * Winner odds for the card. Prefer the live 1X2 market; fall back to the
 * win-probability split, then to a flat default. This keeps the prediction
 * card ALWAYS open, even when the odds feed is momentarily missing.
 */
function winnerOdds(live: LiveState): { home: number; draw: number; away: number } {
  if (live.odds) return live.odds;
  if (live.prob) {
    const fromPct = (p: number) => Math.max(1.05, Math.round((100 / Math.max(1, p)) * 100) / 100);
    return {
      home: fromPct(live.prob.home),
      draw: fromPct(live.prob.draw),
      away: fromPct(live.prob.away),
    };
  }
  return { home: 2.5, draw: 3.2, away: 2.8 };
}

/**
 * Build the card for the fixture's current round. Before kickoff this is a
 * pre-match winner pick (round -1); after the final whistle there is no
 * card. The card is always available while the match is not final, even
 * when the odds feed is momentarily empty. Deterministic given the state.
 */
export function buildCard(
  live: LiveState,
  names: { home: string; away: string },
): GameCard | null {
  if (isFinal(live.statusId)) return null;

  // Pre-match: no clock yet (or explicitly not started). Lock in a winner
  // call before kickoff, priced from the 1X2 market (or a fallback).
  if (live.clockSeconds === null || live.statusId === null || live.statusId === "NS") {
    const o = winnerOdds(live);
    return {
      fixtureId: live.fixtureId,
      round: PREMATCH_ROUND,
      kind: "result",
      question: "Call it before kickoff: who wins?",
      options: [
        opt("home", names.home, o.home),
        opt("draw", "Draw", o.draw),
        opt("away", names.away, o.away),
      ],
      baseline: { goals: 0, corners: 0, clockSeconds: 0, deadlineSeconds: null },
    };
  }

  const round = Math.floor(live.clockSeconds / ROUND_SECONDS);
  const minute = Math.floor(live.clockSeconds / 60);
  const goals = live.score ? live.score.home + live.score.away : 0;
  const corners = live.corners ?? 0;

  const kinds: QuestionKind[] = ["result", "nextgoal", "corner"];
  const kind = kinds[round % kinds.length];

  const baseline = {
    goals,
    corners,
    clockSeconds: live.clockSeconds,
    deadlineSeconds: null as number | null,
  };

  if (kind === "result") {
    // From the TxLINE 1X2 market, with a fallback so the card never closes.
    const o = winnerOdds(live);
    return {
      fixtureId: live.fixtureId,
      round,
      kind,
      question: "Who takes it at full time?",
      options: [
        opt("home", names.home, o.home),
        opt("draw", "Draw", o.draw),
        opt("away", names.away, o.away),
      ],
      baseline, // deadlineSeconds null: settles at FT
    };
  }

  if (kind === "nextgoal") {
    const targetMinute = minute + 10;
    // Goal intensity derived from the current TxLINE market: a live draw
    // price falling means an open game. liveliness in [0..1].
    const liveliness = live.prob ? 1 - live.prob.draw / 100 : 0.65;
    const lambdaPerMin = 0.03 * (0.6 + 1.2 * liveliness); // goals per minute
    const pYes = Math.min(0.85, Math.max(0.12, 1 - Math.exp(-lambdaPerMin * 10)));
    return {
      fixtureId: live.fixtureId,
      round,
      kind,
      question: `Goal before ${targetMinute}'?`,
      options: [opt("yes", "Yes", 1 / pYes), opt("no", "No", 1 / (1 - pYes))],
      baseline: { ...baseline, deadlineSeconds: targetMinute * 60 },
    };
  }

  // corner: another corner within 10 minutes, priced off the corner rate so far.
  const targetMinute = minute + 10;
  const ratePerMin = minute > 0 ? corners / minute : 0.15;
  const pYes = Math.min(0.9, Math.max(0.2, ratePerMin * 10 * 0.75));
  return {
    fixtureId: live.fixtureId,
    round,
    kind,
    question: `Corner before ${targetMinute}'?`,
    options: [opt("yes", "Yes", 1 / pYes), opt("no", "No", 1 / (1 - pYes))],
    baseline: { ...baseline, deadlineSeconds: targetMinute * 60 },
  };
}
