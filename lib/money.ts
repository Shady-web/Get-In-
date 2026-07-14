// Shared money helpers (client-safe): coins are whole units, SOL is tracked
// in lamports. Bets can be staked in either currency.

export type Currency = "COIN" | "SOL";

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const MIN_STAKE: Record<Currency, number> = { COIN: 10, SOL: 1_000_000 };

// Coins have a fixed USD value; their SOL value floats with the live SOL price.
export const COIN_USD = 0.00274 / 100; // 100 coins = $0.00274
// Fallback SOL/USD used for display/estimates when the live price isn't known
// yet (payouts and conversions settle server-side at the real market price).
export const FALLBACK_SOL_USD = 75;

/**
 * Convert a coin amount to lamports at its fixed USD value, priced into SOL at
 * the given live SOL/USD rate (or the fallback when a live rate isn't handy).
 */
export function coinsToLamports(coins: number, solPriceUsd: number = FALLBACK_SOL_USD): number {
  const price = solPriceUsd > 0 ? solPriceUsd : FALLBACK_SOL_USD;
  const usd = coins * COIN_USD;
  return Math.floor((usd / price) * LAMPORTS_PER_SOL);
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
