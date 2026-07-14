import { NextResponse } from "next/server";
import { getSolPriceUsd } from "@/lib/sol-price";

export const dynamic = "force-dynamic";

/**
 * GET /api/sol-price — the live 1 SOL price in USD, for client-side coin→SOL
 * previews. Cached server-side; safe to poll.
 */
export async function GET() {
  const usd = await getSolPriceUsd();
  return NextResponse.json({ ok: true, usd });
}
