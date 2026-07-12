// Server-only daily rewards:
//   - a free 100-coin claim each UTC day, and
//   - an in-app devnet SOL airdrop from the house pool (replaces the external
//     faucet), max 0.5 SOL, once per UTC day.
//
// Both use the quest_claims table's unique (player, quest_id, day) constraint
// as the once-a-day guard, so no new schema is needed. The SOL airdrop credits
// the player's spendable balance from the house reserve - the same wallet that
// pays every withdrawal - so there is no double-spend and no round-trip.

import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrCreatePlayer, type PlayerRow } from "@/lib/game";
import { dayKey } from "@/lib/quests";
import {
  adjustHousePool,
  getHouseBalance,
  logLedger,
  logCoinLedger,
  LAMPORTS_PER_SOL,
} from "@/lib/wallet";

export const DAILY_COINS = 100;
export const AIRDROP_MIN_LAMPORTS = 10_000_000; // 0.01 SOL
export const AIRDROP_MAX_LAMPORTS = 500_000_000; // 0.5 SOL

const COIN_QUEST = "daily_coins";
const SOL_QUEST = "sol_airdrop";

function requireDb() {
  const s = getSupabaseAdmin();
  if (!s) throw new Error("Supabase is not configured on the server.");
  return s;
}

/** Whether the player has already taken today's coin claim / SOL airdrop. */
export async function claimStatus(
  identity: string,
): Promise<{ coins: boolean; sol: boolean }> {
  const supabase = requireDb();
  const player = await getOrCreatePlayer(identity);
  const { data } = await supabase
    .from("quest_claims")
    .select("quest_id")
    .eq("player", player.id)
    .eq("day", dayKey())
    .in("quest_id", [COIN_QUEST, SOL_QUEST]);
  const done = new Set((data ?? []).map((r: any) => r.quest_id as string));
  return { coins: done.has(COIN_QUEST), sol: done.has(SOL_QUEST) };
}

/** Claim the free 100 coins for today. Idempotent per UTC day. */
export async function claimDailyCoins(
  identity: string,
): Promise<{ reward: number; player: PlayerRow }> {
  const supabase = requireDb();
  const player = await getOrCreatePlayer(identity);

  // The unique constraint is the double-claim guard: insert first, pay after.
  const { error } = await supabase.from("quest_claims").insert({
    player: player.id,
    quest_id: COIN_QUEST,
    day: dayKey(),
    reward: DAILY_COINS,
  });
  if (error) {
    if (error.code === "23505")
      throw new Error("You already claimed today's coins. Come back tomorrow.");
    throw new Error(`Could not claim: ${error.message}`);
  }

  const { data: updated, error: upErr } = await supabase
    .from("players")
    .update({ coin_balance: (player.coin_balance ?? 0) + DAILY_COINS })
    .eq("id", player.id)
    .select("*")
    .single();
  if (upErr || !updated) {
    throw new Error(`Claim recorded but payout failed: ${upErr?.message ?? "unknown"}.`);
  }
  await logCoinLedger(player.id, "daily_claim", DAILY_COINS, COIN_QUEST);
  return { reward: DAILY_COINS, player: updated as PlayerRow };
}

/**
 * Airdrop devnet SOL from the house pool into the player's spendable balance.
 * Amount is chosen by the player, min 0.01 SOL, max 0.5 SOL, once per UTC day.
 * The house wallet is the reserve that backs the credit (and pays withdrawals),
 * so we require it to currently hold at least the requested amount.
 */
export async function airdropSol(
  identity: string,
  lamports: number,
): Promise<{ lamports: number; player: PlayerRow }> {
  const supabase = requireDb();
  const amount = Math.floor(lamports);
  if (!Number.isFinite(amount) || amount < AIRDROP_MIN_LAMPORTS) {
    throw new Error(`Minimum claim is ${AIRDROP_MIN_LAMPORTS / LAMPORTS_PER_SOL} SOL.`);
  }
  if (amount > AIRDROP_MAX_LAMPORTS) {
    throw new Error(`You can claim up to ${AIRDROP_MAX_LAMPORTS / LAMPORTS_PER_SOL} SOL at a time.`);
  }

  const player = await getOrCreatePlayer(identity);

  // The house pool has to be able to back this claim (it pays withdrawals).
  let house: { lamports: number };
  try {
    house = await getHouseBalance();
  } catch {
    throw new Error("The house pool is unavailable right now. Try again shortly.");
  }
  if (house.lamports < amount) {
    throw new Error("The house pool is topping up. Try a smaller amount or come back soon.");
  }

  // Once-a-day guard via the unique (player, quest_id, day) constraint.
  const { error } = await supabase.from("quest_claims").insert({
    player: player.id,
    quest_id: SOL_QUEST,
    day: dayKey(),
    reward: amount,
  });
  if (error) {
    if (error.code === "23505")
      throw new Error("You already claimed test SOL today. Come back tomorrow.");
    throw new Error(`Could not claim: ${error.message}`);
  }

  // Credit the player's spendable balance from the house reserve.
  const { data: row } = await supabase
    .from("players")
    .select("sol_balance")
    .eq("id", player.id)
    .single();
  const balance = Number(row?.sol_balance ?? 0) + amount;
  const { data: updated, error: upErr } = await supabase
    .from("players")
    .update({ sol_balance: balance })
    .eq("id", player.id)
    .select("*")
    .single();
  if (upErr || !updated) {
    throw new Error(`Claim recorded but credit failed: ${upErr?.message ?? "unknown"}.`);
  }
  await logLedger(player.id, "house_airdrop", amount, "SOL", "house");
  // The airdrop is drawn from the house pool (which losing SOL stakes feed).
  await adjustHousePool(-amount);
  return { lamports: amount, player: updated as PlayerRow };
}
