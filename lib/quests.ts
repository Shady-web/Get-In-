// Server-only daily quests: 3 per day, rotating deterministically from the
// date (same quests for every player, no cron). Progress is computed live
// from data the app already stores (bet_slips, bet_legs); rewards are paid
// once per player per quest per day via quest_claims.

import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrCreatePlayer, type PlayerRow } from "@/lib/game";
import { logCoinLedger } from "@/lib/wallet";

export const QUESTS_PER_DAY = 3;

/** Normalized "what happened today" snapshot the calculators run over. */
export interface QuestRows {
  slips: {
    legs: number;
    stake: number;
    status: string; // pending | won | lost | void | cashed
    placedToday: boolean;
    settledToday: boolean;
  }[];
}

export interface QuestDef {
  id: string;
  title: string;
  detail: string;
  reward: number; // coins
  target: number;
  progress: (rows: QuestRows) => number;
}

export const QUEST_POOL: QuestDef[] = [
  {
    id: "place_3",
    title: "Get involved",
    detail: "Place 3 bets today",
    reward: 150,
    target: 3,
    progress: (r) => r.slips.filter((s) => s.placedToday).length,
  },
  {
    id: "win_singles_2",
    title: "Sniper",
    detail: "Win 2 singles today",
    reward: 300,
    target: 2,
    progress: (r) =>
      r.slips.filter((s) => s.legs === 1 && s.status === "won" && s.settledToday).length,
  },
  {
    id: "win_acca",
    title: "Chain reaction",
    detail: "Win an accumulator today",
    reward: 400,
    target: 1,
    progress: (r) =>
      r.slips.filter((s) => s.legs >= 2 && s.status === "won" && s.settledToday).length,
  },
  {
    id: "cashout_1",
    title: "Cool head",
    detail: "Cash out a SOL bet today",
    reward: 150,
    target: 1,
    progress: (r) => r.slips.filter((s) => s.status === "cashed" && s.settledToday).length,
  },
  {
    id: "stake_300",
    title: "High stakes",
    detail: "Stake 300 coins in total today",
    reward: 100,
    target: 300,
    progress: (r) =>
      r.slips.filter((s) => s.placedToday).reduce((sum, s) => sum + s.stake, 0),
  },
];

/** UTC day number (days since epoch). */
export function dayNumber(now = Date.now()): number {
  return Math.floor(now / 86_400_000);
}

/** UTC day key like "2026-07-05" (matches the quest_claims.day column). */
export function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Tiny seeded PRNG (mulberry32): deterministic shuffle across servers.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's 3 quests, same for everyone, purely a function of the date. */
export function dailyQuests(day = dayNumber()): QuestDef[] {
  const rand = mulberry32(day * 2654435761);
  const ids = QUEST_POOL.map((q) => q.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids
    .slice(0, QUESTS_PER_DAY)
    .map((id) => QUEST_POOL.find((q) => q.id === id)!);
}

// --- Progress + claims ---------------------------------------------------------------

function requireDb() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  return supabase;
}

async function fetchQuestRows(playerId: string, now = Date.now()): Promise<QuestRows> {
  const supabase = requireDb();
  const dayStart = `${dayKey(now)}T00:00:00.000Z`;

  const { data: slipsData } = await supabase
    .from("bet_slips")
    .select("stake, status, placed_at, settled_at, bet_legs(id)")
    .eq("player", playerId)
    .or(`placed_at.gte.${dayStart},settled_at.gte.${dayStart}`);

  const slips = (slipsData ?? []).map((s: any) => ({
    legs: Array.isArray(s.bet_legs) ? s.bet_legs.length : 0,
    stake: Number(s.stake ?? 0),
    status: String(s.status ?? "pending"),
    placedToday: Boolean(s.placed_at && s.placed_at >= dayStart),
    settledToday: Boolean(s.settled_at && s.settled_at >= dayStart),
  }));

  return { slips };
}

export interface QuestStatus {
  id: string;
  title: string;
  detail: string;
  reward: number;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
}

export async function questBoard(identity: string): Promise<{ day: string; quests: QuestStatus[] }> {
  const supabase = requireDb();
  const player = await getOrCreatePlayer(identity);
  const quests = dailyQuests();
  const day = dayKey();

  const [rows, claimsRes] = await Promise.all([
    fetchQuestRows(player.id),
    supabase
      .from("quest_claims")
      .select("quest_id")
      .eq("player", player.id)
      .eq("day", day),
  ]);
  const claimed = new Set((claimsRes.data ?? []).map((c: any) => c.quest_id as string));

  return {
    day,
    quests: quests.map((q) => {
      const progress = Math.min(q.target, q.progress(rows));
      return {
        id: q.id,
        title: q.title,
        detail: q.detail,
        reward: q.reward,
        target: q.target,
        progress,
        done: progress >= q.target,
        claimed: claimed.has(q.id),
      };
    }),
  };
}

export async function claimQuest(
  identity: string,
  questId: string,
): Promise<{ reward: number; player: PlayerRow }> {
  const supabase = requireDb();
  const player = await getOrCreatePlayer(identity);
  const quest = dailyQuests().find((q) => q.id === questId);
  if (!quest) throw new Error("That quest is not on today's board.");

  const rows = await fetchQuestRows(player.id);
  if (quest.progress(rows) < quest.target) {
    throw new Error("Quest not finished yet.");
  }

  // The unique constraint is the double-claim guard: insert first, pay after.
  const { error } = await supabase.from("quest_claims").insert({
    player: player.id,
    quest_id: quest.id,
    day: dayKey(),
    reward: quest.reward,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Already claimed today.");
    throw new Error(`Could not claim: ${error.message}`);
  }

  const { data: updated, error: coinErr } = await supabase
    .from("players")
    .update({ coin_balance: (player.coin_balance ?? 0) + quest.reward })
    .eq("id", player.id)
    .select("*")
    .single();
  if (coinErr || !updated) {
    throw new Error(`Claim recorded but payout failed: ${coinErr?.message ?? "unknown"}.`);
  }
  await logCoinLedger(player.id, "quest_reward", quest.reward, quest.id);
  return { reward: quest.reward, player: updated as PlayerRow };
}
