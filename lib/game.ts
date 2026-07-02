// Server-only prediction game engine.
//
// A new prediction card appears every ~60 seconds of MATCH clock (a "round").
// Question types rotate by round number so every client computes the same
// card for the same round. Point values come from odds: points = round(odds * 10),
// so less likely picks pay more. Picks store the odds snapshot; settlement
// happens lazily on later polls, comparing against the live TxLINE feed.

import type { LiveState } from "@/lib/live";
import { getSupabaseAdmin } from "@/lib/supabase";

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

const FINAL_STATUSES = new Set(["F", "FET", "FPE", "A", "C"]);

export function isFinal(statusId: string | null): boolean {
  return statusId !== null && FINAL_STATUSES.has(statusId);
}

const toPoints = (odds: number) => Math.max(10, Math.round(odds * 10));
const opt = (id: string, label: string, odds: number): GameOption => ({
  id,
  label,
  odds: Math.round(odds * 100) / 100,
  points: toPoints(odds),
});

/**
 * Build the card for the fixture's current round, or null when there is no
 * live clock / the match is over. Deterministic given the same live state.
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

// --- Persistence ------------------------------------------------------------------

export interface PlayerRow {
  id: string;
  wallet_or_nickname: string;
  total_points: number;
  best_streak: number;
  current_streak: number;
}

async function getOrCreatePlayer(identity: string): Promise<PlayerRow> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  const { data, error } = await supabase
    .from("players")
    .upsert({ wallet_or_nickname: identity }, { onConflict: "wallet_or_nickname" })
    .select("*")
    .single();
  if (error) throw new Error(`Player lookup failed: ${error.message}`);
  const row = data as PlayerRow;
  // current_streak arrives with schema v2; default it if the column is missing.
  return { ...row, current_streak: row.current_streak ?? 0 };
}

export async function savePick(args: {
  identity: string;
  live: LiveState;
  names: { home: string; away: string };
  round: number;
  choice: string;
}): Promise<{ pick: GameOption; card: GameCard }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");

  const card = buildCard(args.live, args.names);
  if (!card) throw new Error("No open prediction right now.");
  if (card.round !== args.round) {
    throw new Error("That round just closed. A new card is up.");
  }
  const option = card.options.find((o) => o.id === args.choice);
  if (!option) throw new Error("Unknown choice for this card.");

  const player = await getOrCreatePlayer(args.identity);
  const { error } = await supabase.from("predictions").insert({
    player: player.id,
    match_id: String(card.fixtureId),
    round: card.round,
    kind: card.kind,
    question: card.question,
    choice: option.id,
    odds_at_pick: option.odds,
    baseline: card.baseline,
  });
  if (error) {
    if (error.code === "23505") throw new Error("You already picked this round.");
    throw new Error(`Could not save the pick: ${error.message}`);
  }
  return { pick: option, card };
}

// --- Settlement ---------------------------------------------------------------------

export interface SettledResult {
  question: string;
  choice: string;
  result: "won" | "lost";
  points: number;
}

/**
 * Settle every due prediction for this player+fixture against the live feed.
 * "Due" means: match finished (result questions), or a goal/corner arrived,
 * or the clock passed the deadline. Awards points, bumps or resets streaks.
 */
export async function settleDue(
  identity: string,
  live: LiveState,
): Promise<{ settled: SettledResult[]; player: PlayerRow | null }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { settled: [], player: null };

  const player = await getOrCreatePlayer(identity);
  const { data: open, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("player", player.id)
    .eq("match_id", String(live.fixtureId))
    .is("result", null)
    .order("round", { ascending: true });
  if (error) throw new Error(`Could not read predictions: ${error.message}`);
  if (!open || open.length === 0) return { settled: [], player };

  const final = isFinal(live.statusId);
  const clock = live.clockSeconds ?? 0;
  const goalsNow = live.score ? live.score.home + live.score.away : 0;
  const cornersNow = live.corners ?? 0;

  const settled: SettledResult[] = [];
  let totalPoints = player.total_points;
  let currentStreak = player.current_streak ?? 0;
  let bestStreak = player.best_streak;

  for (const row of open) {
    const base = (row.baseline ?? {}) as {
      goals?: number;
      corners?: number;
      deadlineSeconds?: number | null;
    };
    const deadline = base.deadlineSeconds ?? null;

    let outcome: boolean | null = null; // did the player's choice win?

    if (row.kind === "result") {
      if (final && live.score) {
        const winner =
          live.score.home > live.score.away
            ? "home"
            : live.score.away > live.score.home
              ? "away"
              : "draw";
        outcome = row.choice === winner;
      }
    } else {
      const now = row.kind === "nextgoal" ? goalsNow : cornersNow;
      const then = (row.kind === "nextgoal" ? base.goals : base.corners) ?? 0;
      const happened = now > then;
      if (happened) {
        outcome = row.choice === "yes";
      } else if (final || (deadline !== null && clock >= deadline)) {
        outcome = row.choice === "no";
      }
    }

    if (outcome === null) continue; // not due yet

    const points = outcome ? Math.max(10, Math.round(Number(row.odds_at_pick) * 10)) : 0;
    const { error: upErr } = await supabase
      .from("predictions")
      .update({
        result: outcome ? "won" : "lost",
        points_awarded: points,
        settled_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .is("result", null); // guard against double settlement
    if (upErr) continue;

    if (outcome) {
      totalPoints += points;
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
    settled.push({
      question: row.question ?? "",
      choice: row.choice,
      result: outcome ? "won" : "lost",
      points,
    });
  }

  if (settled.length > 0) {
    const { data: updated } = await supabase
      .from("players")
      .update({
        total_points: totalPoints,
        current_streak: currentStreak,
        best_streak: bestStreak,
      })
      .eq("id", player.id)
      .select("*")
      .single();
    return { settled, player: (updated as PlayerRow) ?? player };
  }
  return { settled, player };
}
