import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { ensurePlayer } from "@/lib/game";
import { ensureWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/**
 * POST /api/player (authenticated bootstrap, called right after login)
 *
 * Ensures the players row for the verified auth user (username from
 * sign-up metadata, else the email prefix) and the custodial devnet wallet
 * (generated server-side on first login, NEVER funded by us). Returns the
 * player row; the wallet secret never leaves the server.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const player = await ensurePlayer(user);
    let walletWarning: string | undefined;
    try {
      await ensureWallet(player.id);
    } catch (err) {
      // Wallet table missing (schema-v8 not run yet): the game still works.
      walletWarning = err instanceof Error ? err.message : "Wallet unavailable.";
    }
    return NextResponse.json({ ok: true, player, warning: walletWarning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load your player.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
}
