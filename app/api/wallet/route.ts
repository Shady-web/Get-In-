import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { getOrCreatePlayer } from "@/lib/game";
import { checkHouseFloat, getWalletInfo } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet (authenticated)
 *
 * The caller's custodial devnet wallet: address + live balance in SOL and
 * USD (priced at the live SOL market rate). Creates the keypair on first
 * call; never funds it. The secret key stays server-side, always.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const player = await getOrCreatePlayer(user.userId);
    const wallet = await getWalletInfo(player.id, Number(player.sol_balance ?? 0));
    // Health check: logs the house float and warns (server console) when it's
    // low, so it's known to top up before a demo. Throttled; never throws.
    void checkHouseFloat();
    return NextResponse.json({ ok: true, wallet });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wallet unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
}
