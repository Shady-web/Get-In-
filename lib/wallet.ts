// Server-only custodial devnet wallets. On first login every player gets a
// freshly generated Solana keypair stored in the wallets table. We NEVER
// fund it (no airdrops, no house wallet): players hit the public faucet and
// deposit test SOL themselves. Secrets never leave the server; API responses
// carry the public key only.

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getSupabaseAdmin } from "@/lib/supabase";

export const SOL_USD_RATE = 150; // hard-coded display rate: 1 SOL = $150
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const MIN_WITHDRAW_LAMPORTS = 6_700_000; // 0.0067 SOL
const NETWORK_FEE_BUFFER = 10_000; // leave room for the tx fee on-chain

const RPC_URL = () => process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

export interface WalletInfo {
  address: string;
  lamports: number; // spendable custodial balance (deposits + winnings - stakes)
  sol: number;
  usd: number;
  onchain: number; // raw on-chain devnet balance (total ever deposited)
  rate: number;
  stale: boolean; // true when the RPC was unreachable and this is the stored value
}

function requireDb() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase is not configured on the server.");
  return supabase;
}

/** Load the custodial Keypair for a player (server-side only). */
async function loadKeypair(playerId: string): Promise<Keypair> {
  const supabase = requireDb();
  const { data } = await supabase
    .from("wallets")
    .select("secret")
    .eq("player", playerId)
    .maybeSingle();
  if (!data?.secret) throw new Error("No wallet found for this account.");
  const bytes = Uint8Array.from(JSON.parse(data.secret as string) as number[]);
  return Keypair.fromSecretKey(bytes);
}

/**
 * Send devnet SOL from the player's custodial wallet to an external address
 * and debit their spendable balance. Min 0.0067 SOL. The keypair is loaded,
 * signs, and is discarded server-side; it never reaches the browser.
 */
export async function withdrawSol(
  playerId: string,
  toAddress: string,
  lamports: number,
): Promise<{ signature: string; lamports: number; balance: number }> {
  const supabase = requireDb();

  const amount = Math.floor(lamports);
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_LAMPORTS) {
    throw new Error(`Minimum withdrawal is ${MIN_WITHDRAW_LAMPORTS / LAMPORTS_PER_SOL} SOL.`);
  }
  let destination: PublicKey;
  try {
    destination = new PublicKey(toAddress.trim());
  } catch {
    throw new Error("That is not a valid Solana address.");
  }

  // Check the spendable (custodial) balance first.
  const { data: row } = await supabase
    .from("players")
    .select("sol_balance")
    .eq("id", playerId)
    .single();
  const spendable = Number(row?.sol_balance ?? 0);
  if (spendable < amount) {
    throw new Error(
      `Not enough SOL: you have ${(spendable / LAMPORTS_PER_SOL).toFixed(4)} SOL spendable.`,
    );
  }

  const keypair = await loadKeypair(playerId);
  const connection = new Connection(RPC_URL(), "confirmed");

  // The custodial wallet pays the network fee on top of the sent amount.
  const onchain = await connection.getBalance(keypair.publicKey);
  if (onchain < amount + NETWORK_FEE_BUFFER) {
    throw new Error("On-chain balance is too low to cover the network fee right now.");
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: destination,
      lamports: amount,
    }),
  );
  let signature: string;
  try {
    signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
      commitment: "confirmed",
    });
  } catch (err) {
    throw new Error(
      `Withdrawal failed on-chain: ${err instanceof Error ? err.message : "unknown error"}.`,
    );
  }

  // Debit the spendable balance and re-anchor sol_seen to the new on-chain
  // total, so the next deposit check measures deposits from here.
  const balance = spendable - amount;
  let newOnchain = onchain - amount;
  try {
    newOnchain = await connection.getBalance(keypair.publicKey);
  } catch {
    /* estimate is fine */
  }
  await supabase
    .from("players")
    .update({ sol_balance: balance, sol_seen: newOnchain })
    .eq("id", playerId);
  balanceCache.set(keypair.publicKey.toBase58(), { at: Date.now(), lamports: newOnchain });
  await logLedger(playerId, "withdrawal", -amount, "SOL", destination.toBase58());

  return { signature, lamports: amount, balance };
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
 * The player's wallet info. sol_balance is a spendable custodial balance
 * (SOL is now stakeable), so we do NOT overwrite it with the on-chain value.
 * Instead we detect NEW deposits: whenever the on-chain balance rises above
 * the last amount we credited (sol_seen), the increase is added to the
 * spendable balance once and logged. We never withdraw, so the on-chain
 * balance only moves up.
 */
export async function getWalletInfo(
  playerId: string,
  storedLamports: number,
): Promise<WalletInfo> {
  const supabase = requireDb();
  const address = await ensureWallet(playerId);

  // Current on-chain devnet balance (cached to spare the public RPC).
  let onchain = storedLamports;
  let stale = false;
  const hit = balanceCache.get(address);
  if (hit && Date.now() - hit.at < BALANCE_TTL_MS) {
    onchain = hit.lamports;
  } else {
    try {
      const connection = new Connection(RPC_URL(), "confirmed");
      onchain = await connection.getBalance(new PublicKey(address));
      balanceCache.set(address, { at: Date.now(), lamports: onchain });
    } catch {
      stale = true;
      onchain = storedLamports;
    }
  }

  let spendable = storedLamports;
  if (!stale) {
    const { data: row } = await supabase
      .from("players")
      .select("sol_balance, sol_seen")
      .eq("id", playerId)
      .single();
    spendable = Number(row?.sol_balance ?? storedLamports);
    const seen = Number(row?.sol_seen ?? 0);
    const deposit = onchain - seen;
    if (deposit > 0) {
      spendable += deposit;
      await supabase
        .from("players")
        .update({ sol_balance: spendable, sol_seen: onchain })
        .eq("id", playerId);
      await logLedger(playerId, "deposit_check", deposit, "SOL", address);
    }
  }

  const sol = spendable / LAMPORTS_PER_SOL;
  return {
    address,
    lamports: spendable,
    sol,
    usd: Math.round(sol * SOL_USD_RATE * 100) / 100,
    onchain,
    rate: SOL_USD_RATE,
    stale,
  };
}

/** Append a ledger row (best effort: game flow never fails on logging). */
export async function logLedger(
  playerId: string,
  type: string,
  amount: number,
  currency: "SOL" | "COIN",
  ref?: string | null,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !Number.isFinite(amount) || amount === 0) return;
  await supabase.from("ledger").insert({
    player: playerId,
    type,
    amount_lamports: Math.round(amount),
    currency,
    ref: ref ?? null,
  });
}

/** COIN ledger row (back-compat wrapper for quests/claims). */
export async function logCoinLedger(
  playerId: string,
  type: string,
  amount: number,
  ref?: string | null,
): Promise<void> {
  return logLedger(playerId, type, amount, "COIN", ref);
}
