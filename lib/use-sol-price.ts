"use client";

// Client hook for the live SOL/USD price, fetched once and shared across the
// app via a module cache. Used to price coin→SOL conversions and payout
// estimates at the real market rate. Falls back to a constant until loaded.

import { useEffect, useState } from "react";
import { FALLBACK_SOL_USD } from "@/lib/money";

let cached: number | null = null;
let inflight: Promise<number> | null = null;

function load(): Promise<number> {
  if (cached != null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/sol-price")
      .then((r) => r.json())
      .then((b) => {
        const usd = Number(b?.usd);
        cached = Number.isFinite(usd) && usd > 0 ? usd : FALLBACK_SOL_USD;
        return cached;
      })
      .catch(() => FALLBACK_SOL_USD);
  }
  return inflight;
}

/** The latest known SOL/USD price for non-render code (never blocks). */
export function solPriceNow(): number {
  void load();
  return cached ?? FALLBACK_SOL_USD;
}

/** Live SOL/USD price; re-renders when it resolves. */
export function useSolPrice(): number {
  const [price, setPrice] = useState<number>(cached ?? FALLBACK_SOL_USD);
  useEffect(() => {
    let ok = true;
    void load().then((p) => {
      if (ok) setPrice(p);
    });
    return () => {
      ok = false;
    };
  }, []);
  return price;
}
