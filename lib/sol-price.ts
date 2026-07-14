// Server-only: the live SOL/USD price, checked against the market in real time
// and cached briefly so we don't hammer the source. Falls back to a sensible
// constant if the market API is unreachable, so nothing ever blocks on it.

const TTL_MS = 60_000; // one price check per minute is plenty
const FALLBACK_USD = Number(process.env.SOL_USD_FALLBACK) || 75;

let cache: { at: number; usd: number } | null = null;
let inflight: Promise<number> | null = null;

async function fetchPrice(): Promise<number> {
  const url =
    process.env.SOL_PRICE_URL ||
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
  const res = await fetch(url, {
    signal: AbortSignal.timeout(4000),
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const body: any = await res.json();
  // CoinGecko: { solana: { usd: 75.1 } }; allow a couple of other shapes too.
  const usd = Number(body?.solana?.usd ?? body?.usd ?? body?.price);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("bad price payload");
  return usd;
}

/** Live 1 SOL price in USD (cached ~60s; fallback if the market is unreachable). */
export async function getSolPriceUsd(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.usd;
  if (!inflight) {
    inflight = fetchPrice()
      .then((usd) => {
        cache = { at: Date.now(), usd };
        return usd;
      })
      .catch(() => cache?.usd ?? FALLBACK_USD)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
