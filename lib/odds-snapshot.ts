// Server-only: cached raw odds snapshot per fixture, shared by the live
// state (1X2 extraction) and the Markets tab (all markets) so TxLINE sees
// at most one odds request per fixture per ~7s cycle.

import { txlineGet } from "@/lib/txline";

const CACHE_TTL_MS = 6_500;
const cache = new Map<number, { at: number; raw: unknown }>();

export async function getOddsSnapshot(fixtureId: number): Promise<unknown> {
  const hit = cache.get(fixtureId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.raw;
  const raw = await txlineGet(`/odds/snapshot/${fixtureId}`);
  cache.set(fixtureId, { at: Date.now(), raw });
  return raw;
}
