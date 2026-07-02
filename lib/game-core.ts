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

/**
 * Build the card for the fixture's current round, or null when there is no
 * clock yet / the match is over. Deterministic given the same state.
 */
export function buildCard(
  live: LiveState,
  names: { home: string; away: string },
): GameCard | null {
  if (live.clockSeconds === null || isFinal(live.statusId)) return null;

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
    // Straight from the TxLINE 1X2 market. Needs odds to exist.
    if (!live.odds) return null;
    return {
      fixtureId: live.fixtureId,
      round,
      kind,
      question: "Who takes it at full time?",
      options: [
        opt("home", names.home, live.odds.home),
        opt("draw", "Draw", live.odds.draw),
        opt("away", names.away, live.odds.away),
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
