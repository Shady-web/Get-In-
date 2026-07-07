// Server-only coin betting engine: place slips, settle legs from the scores
// data, settle slips, pay out coins. Works identically for live matches and
// Replay Mode (replay legs carry a session id and settle at the replay's
// virtual time).

import type { LiveState } from "@/lib/live";
import { getLiveState } from "@/lib/live";
import { getMarkets } from "@/lib/markets";
import { getReplayTimeline, stateAt } from "@/lib/replay";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logCoinLedger } from "@/lib/wallet";
import { getOrCreatePlayer, isFinal, type PlayerRow } from "@/lib/game";

export interface LegInput {
  fixtureId: number;
  marketKey: string; // "SuperOddsType|Period|Params"
  outcomeName: string; // part1/draw/part2/over/under
  outcomeLabel: string;
  session?: string | null; // replay session
  vt?: number | null; // replay virtual clock at bet time
}

export interface SlipRow {
  id: string;
  stake: number;
  combined_odds: number;
  potential_return: number;
  status: "pending" | "won" | "lost" | "void";
  placed_at: string;
  settled_at: string | null;
  bet_legs: LegRow[];
}

export interface LegRow {
  id: string;
  slip: string;
  match_id: string;
  fixture_id: number;
  session: string | null;
  market_key: string;
  market_label: string;
  outcome_name: string;
  outcome_label: string;
  odds: number;
  result: "pending" | "won" | "lost" | "void";
}

const MIN_STAKE = 10;
const MAX_LEGS = 10;

// --- Leg outcome (pure; unit-testable) -----------------------------------------

/**
 * Decide a leg from the final match state. Returns null while undecidable.
 * Only full-time markets are bettable, so everything settles at the final
 * whistle. Pushes (exact line / level handicap) are void.
 */
export function legOutcome(
  leg: { market_key: string; outcome_name: string },
  state: LiveState,
): "won" | "lost" | "void" | null {
  if (!isFinal(state.statusId) || !state.score) return null;
  const { home, away } = state.score;
  const [superType, , params] = leg.market_key.split("|");
  const line = Number.parseFloat(/line=([-\d.]+)/.exec(params ?? "")?.[1] ?? "NaN");
  const name = leg.outcome_name.toLowerCase();

  if (superType === "1X2_PARTICIPANT_RESULT") {
    const winner = home > away ? "part1" : away > home ? "part2" : "draw";
    return name === winner ? "won" : "lost";
  }

  if (superType === "OVERUNDER_PARTICIPANT_GOALS") {
    if (!Number.isFinite(line)) return "void";
    const total = home + away;
    if (total === line) return "void"; // push on whole-number lines
    const overWins = total > line;
    if (name === "over") return overWins ? "won" : "lost";
    if (name === "under") return overWins ? "lost" : "won";
    return "void";
  }

  if (superType === "ASIANHANDICAP_PARTICIPANT_GOALS") {
    if (!Number.isFinite(line)) return "void";
    const adj = home + line - away; // line applies to part1
    if (adj === 0) return "void"; // push
    const part1Wins = adj > 0;
    if (name === "part1") return part1Wins ? "won" : "lost";
    if (name === "part2") return part1Wins ? "lost" : "won";
    return "void";
  }

  // Unknown market family: refund rather than guess.
  return "void";
}

// --- Placing slips ------------------------------------------------------------------

const SESSION_RE = /^r\d+-[a-z0-9]{4,24}$/;

/** Full-time period values seen in the wild: null, "", "null", "FT", "full". */
function isFullTimePeriod(period: string | undefined | null): boolean {
  const p = String(period ?? "").toLowerCase();
  return p === "" || p === "null" || p === "ft" || p.includes("full");
}

function pick1X2Odds(
  odds: { home: number; draw: number; away: number },
  outcomeName: string,
): number {
  return outcomeName === "part1" || outcomeName === "1" || outcomeName === "home"
    ? odds.home
    : outcomeName === "part2" || outcomeName === "2" || outcomeName === "away"
      ? odds.away
      : odds.draw;
}

/** Resolve a leg's CURRENT odds server-side; the client never sets prices. */
async function resolveLeg(input: LegInput): Promise<{
  matchId: string;
  odds: number;
  marketLabel: string;
}> {
  const [superType, period] = input.marketKey.split("|");
  if (!isFullTimePeriod(period)) {
    throw new Error("Only full-time markets are bettable for now.");
  }

  if (input.session) {
    if (!SESSION_RE.test(input.session)) throw new Error("Invalid replay session.");
    if (superType !== "1X2_PARTICIPANT_RESULT") {
      throw new Error("Replay betting covers the match-winner market.");
    }
    const timeline = await getReplayTimeline(input.fixtureId);
    const state = stateAt(timeline, Math.max(0, input.vt ?? 0));
    if (isFinal(state.statusId)) {
      throw new Error("That replay already reached full time. Restart it to bet.");
    }
    if (!state.odds) throw new Error("No odds at this point of the replay yet.");
    return {
      matchId: input.session,
      odds: pick1X2Odds(state.odds, input.outcomeName),
      marketLabel: "Match winner",
    };
  }

  const [live, markets] = await Promise.all([
    getLiveState(input.fixtureId),
    getMarkets(input.fixtureId),
  ]);
  if (isFinal(live.statusId)) throw new Error("That match has already finished.");

  const market = markets.find((m) => m.key === input.marketKey);
  const outcome = market?.outcomes.find((o) => o.name === input.outcomeName);
  if (market && outcome) {
    return { matchId: String(input.fixtureId), odds: outcome.price, marketLabel: market.label };
  }

  // Match-winner fallback: even if the snapshot momentarily misses the exact
  // market key, the 1X2 prices come straight from the live state. Pre-match
  // and in-play bets on the winner should basically never bounce.
  if (superType.includes("1X2") && live.odds) {
    return {
      matchId: String(input.fixtureId),
      odds: pick1X2Odds(live.odds, input.outcomeName),
      marketLabel: "Match winner",
    };
  }

  throw new Error(
    market
      ? "That price was pulled. Refresh Markets and re-add the pick."
      : "That line moved since you picked it. Refresh Markets and re-add the pick.",
  );
}

export async function placeSlip(args: {
  identity: string;
  stake: number;
  legs: LegInput[];
}): Promise<{ slip: SlipRow; player: PlayerRow }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");

  const stake = Math.floor(args.stake);
  if (!Number.isFinite(stake) || stake < MIN_STAKE) {
    throw new Error(`Minimum stake is ${MIN_STAKE} coins.`);
  }
  if (args.legs.length === 0) throw new Error("The slip is empty.");
  if (args.legs.length > MAX_LEGS) throw new Error(`Max ${MAX_LEGS} legs per slip.`);

  // One pick per market per slip (classic accumulator rule).
  const marketIds = args.legs.map((l) => `${l.session ?? l.fixtureId}|${l.marketKey}`);
  if (new Set(marketIds).size !== marketIds.length) {
    throw new Error("Only one pick per market on a slip.");
  }

  const resolved = await Promise.all(args.legs.map(resolveLeg));
  const combined = resolved.reduce((acc, r) => acc * r.odds, 1);
  const potential = Math.floor(stake * combined);

  const player = await getOrCreatePlayer(args.identity);
  if ((player.coin_balance ?? 0) < stake) {
    throw new Error(`Not enough coins: you have ${player.coin_balance ?? 0}.`);
  }

  // Conditional deduction guards against double-spends without transactions.
  const { data: paid, error: payErr } = await supabase
    .from("players")
    .update({ coin_balance: (player.coin_balance ?? 0) - stake })
    .eq("id", player.id)
    .gte("coin_balance", stake)
    .select("*")
    .single();
  if (payErr || !paid) throw new Error("Could not reserve the stake. Try again.");

  const { data: slip, error: slipErr } = await supabase
    .from("bet_slips")
    .insert({
      player: player.id,
      stake,
      combined_odds: Math.round(combined * 1000) / 1000,
      potential_return: potential,
    })
    .select("*")
    .single();
  if (slipErr || !slip) {
    await supabase.from("players").update({ coin_balance: paid.coin_balance + stake }).eq("id", player.id);
    throw new Error(`Could not place the bet: ${slipErr?.message ?? "unknown error"}.`);
  }

  const legRows = args.legs.map((l, i) => ({
    slip: slip.id,
    match_id: resolved[i].matchId,
    fixture_id: l.fixtureId,
    session: l.session ?? null,
    market_key: l.marketKey,
    market_label: resolved[i].marketLabel,
    outcome_name: l.outcomeName,
    outcome_label: l.outcomeLabel.slice(0, 60),
    odds: resolved[i].odds,
  }));
  const { error: legsErr } = await supabase.from("bet_legs").insert(legRows);
  if (legsErr) {
    await supabase.from("bet_slips").delete().eq("id", slip.id);
    await supabase.from("players").update({ coin_balance: paid.coin_balance + stake }).eq("id", player.id);
    throw new Error(`Could not save the legs: ${legsErr.message}.`);
  }

  await logCoinLedger(player.id, "bet_stake", -stake, slip.id);

  const { data: full } = await supabase
    .from("bet_slips")
    .select("*, bet_legs(*)")
    .eq("id", slip.id)
    .single();
  return { slip: full as SlipRow, player: paid as PlayerRow };
}

// --- Settlement -----------------------------------------------------------------------

export interface SlipResult {
  slipId: string;
  status: "won" | "lost" | "void";
  payout: number;
}

/**
 * Settle this player's pending legs on one match from the given state, then
 * settle any slips whose legs are all resolved. Returns what changed.
 */
export async function settleSlipsForMatch(
  identity: string,
  matchId: string,
  state: LiveState,
): Promise<{ results: SlipResult[]; player: PlayerRow | null }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { results: [], player: null };
  if (!isFinal(state.statusId)) return { results: [], player: null };

  const player = await getOrCreatePlayer(identity);
  const { data: legs } = await supabase
    .from("bet_legs")
    .select("*, bet_slips!inner(id, player, stake, status)")
    .eq("match_id", matchId)
    .eq("result", "pending")
    .eq("bet_slips.player", player.id);
  if (!legs || legs.length === 0) return { results: [], player };

  const touchedSlips = new Set<string>();
  for (const leg of legs) {
    const outcome = legOutcome(leg as LegRow, state);
    if (!outcome) continue;
    const { error } = await supabase
      .from("bet_legs")
      .update({ result: outcome, settled_at: new Date().toISOString() })
      .eq("id", leg.id)
      .eq("result", "pending");
    if (!error) touchedSlips.add(leg.slip);
  }

  const results: SlipResult[] = [];
  let coinsDelta = 0;

  for (const slipId of touchedSlips) {
    const { data: slip } = await supabase
      .from("bet_slips")
      .select("*, bet_legs(*)")
      .eq("id", slipId)
      .eq("status", "pending")
      .single();
    if (!slip) continue;
    const slipLegs = (slip.bet_legs ?? []) as LegRow[];

    if (slipLegs.some((l) => l.result === "lost")) {
      await supabase
        .from("bet_slips")
        .update({ status: "lost", settled_at: new Date().toISOString() })
        .eq("id", slipId)
        .eq("status", "pending");
      results.push({ slipId, status: "lost", payout: 0 });
      continue;
    }
    if (slipLegs.some((l) => l.result === "pending")) continue; // other matches open

    // All legs won or void: void legs pay 1.0. All-void slips refund the stake.
    const allVoid = slipLegs.every((l) => l.result === "void");
    const odds = slipLegs.reduce(
      (acc, l) => acc * (l.result === "won" ? Number(l.odds) : 1),
      1,
    );
    const payout = allVoid ? Number(slip.stake) : Math.floor(Number(slip.stake) * odds);
    const { error } = await supabase
      .from("bet_slips")
      .update({
        status: allVoid ? "void" : "won",
        settled_at: new Date().toISOString(),
      })
      .eq("id", slipId)
      .eq("status", "pending");
    if (!error) {
      coinsDelta += payout;
      results.push({ slipId, status: allVoid ? "void" : "won", payout });
      await logCoinLedger(player.id, allVoid ? "bet_void_refund" : "bet_payout", payout, slipId);
    }
  }

  let updated: PlayerRow | null = player;
  if (coinsDelta > 0) {
    const { data } = await supabase
      .from("players")
      .update({ coin_balance: (player.coin_balance ?? 0) + coinsDelta })
      .eq("id", player.id)
      .select("*")
      .single();
    updated = (data as PlayerRow) ?? player;
  }
  return { results, player: updated };
}

// --- Cash out ---------------------------------------------------------------------

const CASHOUT_MARGIN = 0.95;

/**
 * Live cash-out value of an open slip:
 *   potential_return x PRODUCT(current implied prob of each pending leg) x 0.95
 * where implied prob = 1 / current decimal odds. Decided legs count as prob 1
 * (won) or kill the value (lost). Returns null when unpriceable: a pending
 * leg's market is gone, or the leg belongs to a replay session (replays
 * settle in minutes; no cash out there).
 */
export function slipCashValue(
  slip: { stake: number | string; potential_return: number | string },
  legs: Pick<LegRow, "result" | "session" | "market_key" | "outcome_name" | "fixture_id">[],
  currentOddsOf: (
    leg: Pick<LegRow, "market_key" | "outcome_name" | "fixture_id">,
  ) => number | null,
): number | null {
  let probProduct = 1;
  for (const leg of legs) {
    if (leg.result === "lost") return 0;
    if (leg.result === "won" || leg.result === "void") continue;
    if (leg.session) return null; // replay legs: no cash out
    const current = currentOddsOf(leg);
    if (current === null || current <= 1) return null;
    probProduct *= 1 / current;
  }
  return Math.floor(Number(slip.potential_return) * probProduct * CASHOUT_MARGIN);
}

/** Build a current-odds resolver over the fixtures a slip touches. */
async function oddsResolverFor(
  legs: Pick<LegRow, "fixture_id" | "result" | "session">[],
): Promise<Map<number, Awaited<ReturnType<typeof getMarkets>>>> {
  const fixtureIds = [
    ...new Set(
      legs.filter((l) => l.result === "pending" && !l.session).map((l) => l.fixture_id),
    ),
  ];
  const entries: [number, Awaited<ReturnType<typeof getMarkets>>][] =
    await Promise.all(
      fixtureIds.map(async (id): Promise<[number, Awaited<ReturnType<typeof getMarkets>>]> => {
        try {
          return [id, await getMarkets(id)];
        } catch {
          return [id, []];
        }
      }),
    );
  return new Map(entries);
}

function currentOddsLookup(
  marketsByFixture: Map<number, Awaited<ReturnType<typeof getMarkets>>>,
) {
  return (leg: Pick<LegRow, "market_key" | "outcome_name" | "fixture_id">) => {
    const markets = marketsByFixture.get(leg.fixture_id) ?? [];
    const market = markets.find((m) => m.key === leg.market_key);
    const outcome = market?.outcomes.find((o) => o.name === leg.outcome_name);
    return outcome ? outcome.price : null;
  };
}

/** Attach a live cashValue to each pending slip (null = not cashable now). */
export async function withCashValues(slips: SlipRow[]): Promise<
  (SlipRow & { cashValue: number | null })[]
> {
  const pendingLegs = slips
    .filter((s) => s.status === "pending")
    .flatMap((s) => s.bet_legs ?? []);
  const marketsByFixture = await oddsResolverFor(pendingLegs);
  const lookup = currentOddsLookup(marketsByFixture);

  return slips.map((s) => ({
    ...s,
    cashValue:
      s.status === "pending" ? slipCashValue(s, s.bet_legs ?? [], lookup) : null,
  }));
}

/** Cash a slip out at its freshly computed value. */
export async function cashOutSlip(
  identity: string,
  slipId: string,
): Promise<{ amount: number; player: PlayerRow }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");

  const player = await getOrCreatePlayer(identity);
  const { data: slip } = await supabase
    .from("bet_slips")
    .select("*, bet_legs(*)")
    .eq("id", slipId)
    .eq("player", player.id)
    .eq("status", "pending")
    .single();
  if (!slip) throw new Error("That slip is no longer open.");

  const legs = (slip.bet_legs ?? []) as LegRow[];
  const marketsByFixture = await oddsResolverFor(legs);
  const lookup = currentOddsLookup(marketsByFixture);
  const amount = slipCashValue(slip, legs, lookup);
  if (amount === null) {
    throw new Error("Cash out is unavailable right now (a market is unpriced).");
  }

  // pending -> cashed transition guards double cash-outs.
  const { data: updated, error } = await supabase
    .from("bet_slips")
    .update({
      status: "cashed",
      cashout_amount: amount,
      settled_at: new Date().toISOString(),
    })
    .eq("id", slipId)
    .eq("status", "pending")
    .select("id")
    .single();
  if (error || !updated) throw new Error("That slip just settled. No cash out needed.");

  const { data: paid } = await supabase
    .from("players")
    .update({ coin_balance: (player.coin_balance ?? 0) + amount })
    .eq("id", player.id)
    .select("*")
    .single();
  await logCoinLedger(player.id, "cashout", amount, slipId);
  return { amount, player: (paid as PlayerRow) ?? player };
}

/** Void + refund replay legs stuck pending for over 24h (abandoned replays). */
export async function voidStaleReplayLegs(identity: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const player = await getOrCreatePlayer(identity);
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

  const { data: legs } = await supabase
    .from("bet_legs")
    .select("id, slip, bet_slips!inner(player, placed_at, status)")
    .eq("result", "pending")
    .not("session", "is", null)
    .eq("bet_slips.player", player.id)
    .lt("bet_slips.placed_at", cutoff);
  if (!legs || legs.length === 0) return;

  for (const leg of legs) {
    await supabase
      .from("bet_legs")
      .update({ result: "void", settled_at: new Date().toISOString() })
      .eq("id", leg.id)
      .eq("result", "pending");
  }
  // Re-settle affected slips with a synthetic final state (voids pay 1.0).
  const slipIds = [...new Set(legs.map((l: any) => l.slip))];
  for (const slipId of slipIds) {
    const { data: slip } = await supabase
      .from("bet_slips")
      .select("*, bet_legs(*)")
      .eq("id", slipId)
      .eq("status", "pending")
      .single();
    if (!slip) continue;
    const slipLegs = (slip.bet_legs ?? []) as LegRow[];
    if (slipLegs.some((l) => l.result === "pending")) continue;
    const allVoid = slipLegs.every((l) => l.result === "void");
    const lost = slipLegs.some((l) => l.result === "lost");
    const odds = slipLegs.reduce(
      (acc, l) => acc * (l.result === "won" ? Number(l.odds) : 1),
      1,
    );
    const payout = lost ? 0 : allVoid ? Number(slip.stake) : Math.floor(Number(slip.stake) * odds);
    await supabase
      .from("bet_slips")
      .update({
        status: lost ? "lost" : allVoid ? "void" : "won",
        settled_at: new Date().toISOString(),
      })
      .eq("id", slipId)
      .eq("status", "pending");
    if (payout > 0) {
      const p = await getOrCreatePlayer(identity);
      await supabase
        .from("players")
        .update({ coin_balance: (p.coin_balance ?? 0) + payout })
        .eq("id", p.id);
    }
  }
}
