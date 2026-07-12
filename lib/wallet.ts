// Server-only custodial devnet wallets. On first login every player gets a
// freshly generated Solana keypair stored in the wallets table; players hit
// the public faucet and deposit test SOL into it themselves. Secrets never
// leave the server; API responses carry the public key only.
//
// Withdrawals, however, are paid from a single server-side HOUSE float (see
// loadHouseKeypair): the user's internal sol_balance is the gate + debit, but
// the coins land from the house wallet. That is what lets coin-converted SOL
// winnings be withdrawn even though a user only ever deposited a little real
// SOL. The house key is server-side only and never reaches the browser.

import fs from "node:fs";
import path from "node:path";
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

/** Warn-below-this house balance (SOL). Override with HOUSE_LOW_SOL. */
function houseLowLamports(): number {
  const sol = Number(process.env.HOUSE_LOW_SOL);
  return Math.floor((Number.isFinite(sol) && sol > 0 ? sol : 1) * LAMPORTS_PER_SOL);
}

// --- House float (server-side only) --------------------------------------------

let houseKeypair: Keypair | null = null;

/**
 * Load the single house keypair that pays every withdrawal. Prefers the
 * HOUSE_WALLET_SECRET env var (a JSON byte array — how Vercel gets it) and
 * falls back to a gitignored .house-keypair.json for local dev. Memoized.
 * Throws a clear, actionable error when neither is configured.
 */
export function loadHouseKeypair(): Keypair {
  if (houseKeypair) return houseKeypair;

  const secret = process.env.HOUSE_WALLET_SECRET?.trim();
  if (secret) {
    try {
      houseKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
      return houseKeypair;
    } catch {
      throw new Error("HOUSE_WALLET_SECRET is set but is not a valid JSON secret-key array.");
    }
  }

  const file = process.env.HOUSE_KEYPAIR_PATH || ".house-keypair.json";
  const abs = path.resolve(file);
  if (fs.existsSync(abs)) {
    houseKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(abs, "utf8")) as number[]),
    );
    return houseKeypair;
  }

  throw new Error(
    "No house wallet configured. Run `npm run setup:house` for local dev, " +
      "or set HOUSE_WALLET_SECRET in your environment for a deploy.",
  );
}

/** The house float's address and on-chain balance (for the health check + script). */
export async function getHouseBalance(): Promise<{
  address: string;
  lamports: number;
  sol: number;
}> {
  const house = loadHouseKeypair();
  const connection = new Connection(RPC_URL(), "confirmed");
  const lamports = await connection.getBalance(house.publicKey);
  return { address: house.publicKey.toBase58(), lamports, sol: lamports / LAMPORTS_PER_SOL };
}

let lastFloatCheck = 0;

/**
 * Best-effort health check: log the house float and warn in the console when
 * it drops below the threshold, so it's known to top up before a demo. Called
 * from the wallet route; throttled to once a minute and never throws.
 */
export async function checkHouseFloat(): Promise<void> {
  if (Date.now() - lastFloatCheck < 60_000) return;
  lastFloatCheck = Date.now();
  try {
    const { address, lamports, sol } = await getHouseBalance();
    const threshold = houseLowLamports();
    if (lamports < threshold) {
      console.warn(
        `[house] LOW FLOAT: ${sol.toFixed(4)} SOL at ${address} ` +
          `(below ${(threshold / LAMPORTS_PER_SOL).toFixed(2)} SOL). ` +
          "Top up from https://faucet.solana.com before the demo.",
      );
    } else {
      console.log(`[house] float OK: ${sol.toFixed(4)} SOL at ${address}.`);
    }
  } catch (err) {
    console.warn(`[house] float check skipped: ${err instanceof Error ? err.message : "unknown"}.`);
  }
}

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

/**
 * Send devnet SOL to an external address and debit the player's spendable
 * balance. Min 0.0067 SOL. The user's internal sol_balance is the gate and
 * the debit, but the coins are paid FROM THE HOUSE float — so winnings
 * converted from coins are withdrawable even though the user only ever
 * deposited a little real SOL. The house keypair signs server-side and is
 * never exposed to the browser.
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

  // Gate on the spendable (internal) balance — this includes coin-converted
  // SOL winnings, which live in sol_balance but not on the user's own wallet.
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

  // Pay from the house float. It covers the sent amount plus the network fee.
  const house = loadHouseKeypair();
  const connection = new Connection(RPC_URL(), "confirmed");
  const houseBalance = await connection.getBalance(house.publicKey);
  if (houseBalance < amount + NETWORK_FEE_BUFFER) {
    console.warn(
      `[house] withdrawal blocked: float ${(houseBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL ` +
        `can't cover ${(amount / LAMPORTS_PER_SOL).toFixed(4)} SOL. Top up from the faucet.`,
    );
    throw new Error("The house float is topping up. Try this withdrawal again shortly.");
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: house.publicKey,
      toPubkey: destination,
      lamports: amount,
    }),
  );
  let signature: string;
  try {
    signature = await sendAndConfirmTransaction(connection, tx, [house], {
      commitment: "confirmed",
    });
  } catch (err) {
    throw new Error(
      `Withdrawal failed on-chain: ${err instanceof Error ? err.message : "unknown error"}.`,
    );
  }

  // Debit the spendable balance. The user's own wallet is untouched (the
  // house paid), so sol_seen stays as-is and future deposits still credit.
  const balance = spendable - amount;
  await supabase.from("players").update({ sol_balance: balance }).eq("id", playerId);
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

// --- House pool (best effort) --------------------------------------------------
//
// A single-row accounting of the house's net SOL position (lamports). Losing
// SOL stakes feed it (staked at placement, kept on a loss); winning payouts,
// void refunds, cash-outs and airdrops draw it down - so losers fund winners.
// All updates are best-effort: if the house_pool table isn't migrated yet (or
// Supabase is down), pool tracking is skipped and the rest of the app is
// unaffected.

/** Shift the house pool by delta lamports (positive = house gains). */
export async function adjustHousePool(deltaLamports: number): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase || !Number.isFinite(deltaLamports) || deltaLamports === 0) return;
  try {
    const { data } = await supabase
      .from("house_pool")
      .select("lamports")
      .eq("id", 1)
      .maybeSingle();
    const next = Number(data?.lamports ?? 0) + Math.round(deltaLamports);
    await supabase
      .from("house_pool")
      .upsert({ id: 1, lamports: next, updated_at: new Date().toISOString() });
  } catch {
    /* table not migrated yet: skip pool tracking */
  }
}

/** The accumulated house pool in lamports (0 if the table is absent). */
export async function getHousePool(): Promise<number> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  try {
    const { data } = await supabase
      .from("house_pool")
      .select("lamports")
      .eq("id", 1)
      .maybeSingle();
    return Number(data?.lamports ?? 0);
  } catch {
    return 0;
  }
}
