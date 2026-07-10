// Shared money helpers (client-safe): coins are whole units, SOL is tracked
// in lamports. Bets can be staked in either currency.

export type Currency = "COIN" | "SOL";

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SOL_USD_RATE = 150; // hard-coded display rate: 1 SOL = $150
export const MIN_STAKE: Record<Currency, number> = { COIN: 10, SOL: 1_000_000 };

// Winning GI-coin calls pay out in SOL at this fixed peg (coins ~ $0.01).
export const COINS_PER_SOL = 15_000;

/** Convert a coin amount to lamports at the fixed payout peg. */
export function coinsToLamports(coins: number): number {
  return Math.floor((coins * LAMPORTS_PER_SOL) / COINS_PER_SOL);
}

/** Format a base-unit amount for display (coins as integers, SOL in SOL). */
export function formatAmount(amount: number, currency: Currency): string {
  if (currency === "SOL") {
    return `${(amount / LAMPORTS_PER_SOL).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    })} SOL`;
  }
  return `${Math.round(amount).toLocaleString()} coins`;
}

/** Parse a user-typed stake into base units for the currency. */
export function parseStake(raw: string, currency: Currency): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return currency === "SOL" ? Math.floor(n * LAMPORTS_PER_SOL) : Math.floor(n);
}

/** The step/placeholder a stake input should use for the currency. */
export const stakePlaceholder: Record<Currency, string> = {
  COIN: "50",
  SOL: "0.05",
};
