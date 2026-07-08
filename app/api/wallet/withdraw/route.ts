import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { getOrCreatePlayer } from "@/lib/game";
import { LAMPORTS_PER_SOL, MIN_WITHDRAW_LAMPORTS, withdrawSol } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/withdraw { address, sol }  (authenticated)
 *
 * Sends devnet SOL from the caller's custodial wallet to an external
 * address and debits their spendable balance. Min 0.0067 SOL. The signing
 * keypair stays server-side.
 */
export async function POST(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }

  let address: string;
  let sol: number;
  try {
    const body = await request.json();
    address = String(body?.address ?? "").trim();
    sol = Number(body?.sol);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ ok: false, error: "Enter a destination address." }, { status: 400 });
  }
  const lamports = Math.floor((Number.isFinite(sol) ? sol : 0) * LAMPORTS_PER_SOL);
  if (lamports < MIN_WITHDRAW_LAMPORTS) {
    return NextResponse.json(
      { ok: false, error: `Minimum withdrawal is ${MIN_WITHDRAW_LAMPORTS / LAMPORTS_PER_SOL} SOL.` },
      { status: 400 },
    );
  }

  try {
    const player = await getOrCreatePlayer(identity);
    const result = await withdrawSol(player.id, address, lamports);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Withdrawal failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
