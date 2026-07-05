// Server-only: cached raw scores snapshot per fixture, shared by the live
// state (fold to latest) and the Pundit ticker (event derivation) so TxLINE
// sees at most one scores request per fixture per ~7s cycle.

import { txlineGet } from "@/lib/txline";

const CACHE_TTL_MS = 6_500;
const cache = new Map<number, { at: number; raw: unknown }>();

export async function getScoresSnapshot(fixtureId: number): Promise<unknown> {
  const hit = cache.get(fixtureId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.raw;
  const raw = await txlineGet(`/scores/snapshot/${fixtureId}`);
  cache.set(fixtureId, { at: Date.now(), raw });
  return raw;
}
