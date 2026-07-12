import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { claimDailyCoins, claimStatus, DAILY_COINS } from "@/lib/rewards";

export const dynamic = "force-dynamic";

/**
 * GET  /api/claim/daily  -> today's claim status { coins, sol } (both booleans)
 * POST /api/claim/daily  -> claim the free 100 coins for today
 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireUser(request);
    const status = await claimStatus(userId);
    return NextResponse.json({ ok: true, ...status, coinsReward: DAILY_COINS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
}

export async function POST(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
  try {
    const { reward, player } = await claimDailyCoins(identity);
    return NextResponse.json({ ok: true, reward, player });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not claim.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
