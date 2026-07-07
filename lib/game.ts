// Server-only prediction game persistence: saving picks and settling them.
// The pure card/odds logic lives in lib/game-core.ts (shared with the
// browser); this file adds Supabase reads/writes on top.
//
// Live matches use matchId = String(fixtureId). Replay sessions use
// matchId = "r{fixtureId}-{nonce}" so replaying a match (even twice)
// never collides with live picks, while scoring the same way.

import type { LiveState } from "@/lib/live";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildCard,
  isFinal,
  toPoints,
  type GameCard,
  type GameOption,
  type SettledResult,
} from "@/lib/game-core";

export type {
  GameCard,
  GameOption,
  SettledResult,
  QuestionKind,
} from "@/lib/game-core";
export { buildCard, isFinal, ROUND_SECONDS } from "@/lib/game-core";

export interface PlayerRow {
  id: string;
  wallet_or_nickname: string; // mirrors username (kept for display code)
  total_points: number;
  best_streak: number;
  current_streak: number;
  auth_user_id?: string | null; // schema v8: the Supabase Auth user id
  username?: string | null;
  coin_balance?: number; // schema v8 (was coins)
  sol_balance?: number; // lamports, schema v8
  last_claim?: string | null;
}

/**
 * Resolve a player by their VERIFIED Supabase auth user id (every route gets
 * it from requireUser; clients can no longer pick their own identity). The
 * row is normally created by the /api/player bootstrap right after login
 * with the real username; this fallback self-heals with a placeholder name.
 */
export async function getOrCreatePlayer(identity: string): Promise<PlayerRow> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  const { data } = await supabase
    .from("players")
    .select("*")
    .eq("auth_user_id", identity)
    .maybeSingle();
  if (data) {
    const row = data as PlayerRow;
    return { ...row, current_streak: row.current_streak ?? 0 };
  }
  return ensurePlayer({ userId: identity, email: null, username: null });
}

/** Sanitize a candidate username: lowercase a-z 0-9 _ only, 3-20 chars. */
export function cleanUsername(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  return s.length >= 3 ? s : "";
}

/**
 * Create (or fetch) the player row for an authenticated user. Username
 * preference: chosen at sign-up (metadata) > email prefix > player_xxxxxx.
 * Collisions with taken usernames retry with a numeric suffix.
 */
export async function ensurePlayer(user: {
  userId: string;
  email: string | null;
  username: string | null;
}): Promise<PlayerRow> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");

  const { data: existing } = await supabase
    .from("players")
    .select("*")
    .eq("auth_user_id", user.userId)
    .maybeSingle();
  if (existing) {
    const row = existing as PlayerRow;
    return { ...row, current_streak: row.current_streak ?? 0 };
  }

  const base =
    cleanUsername(user.username ?? "") ||
    cleanUsername(user.email?.split("@")[0] ?? "") ||
    `player_${user.userId.replace(/-/g, "").slice(0, 6)}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const username =
      attempt === 0 ? base : `${base.slice(0, 16)}${Math.floor(Math.random() * 9000) + 1000}`;
    const { data, error } = await supabase
      .from("players")
      .insert({
        auth_user_id: user.userId,
        username,
        wallet_or_nickname: username,
      })
      .select("*")
      .single();
    if (!error && data) {
      const row = data as PlayerRow;
      return { ...row, current_streak: row.current_streak ?? 0 };
    }
    if (error?.code === "23505") {
      // Either another request created us concurrently (fine, fetch it) or
      // the username is taken (roll a suffix and retry).
      const { data: raced } = await supabase
        .from("players")
        .select("*")
        .eq("auth_user_id", user.userId)
        .maybeSingle();
      if (raced) {
        const row = raced as PlayerRow;
        return { ...row, current_streak: row.current_streak ?? 0 };
      }
      continue;
    }
    throw new Error(`Player lookup failed: ${error?.message ?? "unknown"}`);
  }
  throw new Error("Could not find a free username. Try again.");
}

export async function savePick(args: {
  identity: string;
  live: LiveState;
  names: { home: string; away: string };
  matchId: string;
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
    match_id: args.matchId,
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

/**
 * Settle every due prediction for this player+match against the given state
 * (live TxLINE state, or a synthesized historical state during replay).
 * Awards points, bumps or resets streaks.
 */
export async function settleDue(
  identity: string,
  live: LiveState,
  matchId: string,
): Promise<{ settled: SettledResult[]; player: PlayerRow | null }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { settled: [], player: null };

  const player = await getOrCreatePlayer(identity);
  const { data: open, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("player", player.id)
    .eq("match_id", matchId)
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

    const points = outcome ? toPoints(Number(row.odds_at_pick)) : 0;
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
