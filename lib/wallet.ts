// Server-only custodial devnet wallets. On first login every player gets a
// freshly generated Solana keypair stored in the wallets table. We NEVER
// fund it (no airdrops, no house wallet): players hit the public faucet and
// deposit test SOL themselves. Secrets never leave the server; API responses
// carry the public key only.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getSupabaseAdmin } from "@/lib/supabase";

export const SOL_USD_RATE = 150; // hard-coded display rate: 1 SOL = $150
export const LAMPORTS_PER_SOL = 1_000_000_000;

const RPC_URL = () => process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

export interface WalletInfo {
  address: string;
  lamports: number;
  sol: number;
  usd: number;
  rate: number;
  stale: boolean; // true when the RPC was unreachable and this is the stored value
}

function requireDb() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  return supabase;
}

/** Get (or lazily create) the player's custodial wallet. Returns pubkey only. */
export async function ensureWallet(playerId: string): Promise<string> {
  const supabase = requireDb();
  const { data: existing } = await supabase
    .from("wallets")
    .select("pubkey")
    .eq("player", playerId)
    .maybeSingle();
  if (existing) return existing.pubkey as string;

  const keypair = Keypair.generate();
  const { error } = await supabase.from("wallets").insert({
    player: playerId,
    pubkey: keypair.publicKey.toBase58(),
    // JSON byte array; service-role only table, never exposed to clients.
    secret: JSON.stringify(Array.from(keypair.secretKey)),
  });
  if (error) {
    if (error.code === "23505") {
      // Concurrent first login created it: use theirs.
      const { data: raced } = await supabase
        .from("wallets")
        .select("pubkey")
        .eq("player", playerId)
        .single();
      if (raced) return raced.pubkey as string;
    }
    throw new Error(`Could not create the wallet: ${error.message}`);
  }
  return keypair.publicKey.toBase58();
}

// Devnet RPC answers are cached briefly so a busy wallet screen doesn't
// hammer the public endpoint.
const balanceCache = new Map<string, { at: number; lamports: number }>();
const BALANCE_TTL_MS = 30_000;

/**
 * The player's wallet info with a live devnet balance. Any change against
 * the stored sol_balance is recorded in the ledger as a deposit/withdrawal
 * check, so external faucet deposits show up in the money history.
 */
export async function getWalletInfo(
  playerId: string,
  storedLamports: number,
): Promise<WalletInfo> {
  const supabase = requireDb();
  const address = await ensureWallet(playerId);

  let lamports = storedLamports;
  let stale = false;
  const hit = balanceCache.get(address);
  if (hit && Date.now() - hit.at < BALANCE_TTL_MS) {
    lamports = hit.lamports;
  } else {
    try {
      const connection = new Connection(RPC_URL(), "confirmed");
      lamports = await connection.getBalance(new PublicKey(address));
      balanceCache.set(address, { at: Date.now(), lamports });
    } catch {
      stale = true; // RPC hiccup: show the last stored balance
    }
  }

  if (!stale && lamports !== storedLamports) {
    await supabase.from("players").update({ sol_balance: lamports }).eq("id", playerId);
    await supabase.from("ledger").insert({
      player: playerId,
      type: lamports > storedLamports ? "deposit_check" : "withdrawal_check",
      amount_lamports: lamports - storedLamports,
      currency: "SOL",
      ref: address,
    });
  }

  const sol = lamports / LAMPORTS_PER_SOL;
  return {
    address,
    lamports,
    sol,
    usd: Math.round(sol * SOL_USD_RATE * 100) / 100,
    rate: SOL_USD_RATE,
    stale,
  };
}

/** Append a COIN ledger row (best effort: game flow never fails on logging). */
export async function logCoinLedger(
  playerId: string,
  type: string,
  amount: number,
  ref?: string | null,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !Number.isFinite(amount) || amount === 0) return;
  await supabase.from("ledger").insert({
    player: playerId,
    type,
    amount_lamports: Math.round(amount),
    currency: "COIN",
    ref: ref ?? null,
  });
}
