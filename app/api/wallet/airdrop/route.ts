import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { airdropSol } from "@/lib/rewards";
import { LAMPORTS_PER_SOL } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/airdrop { sol }  (authenticated)
 *
 * Claims devnet SOL from the GetIN house pool into the caller's spendable
 * balance - the in-app replacement for the public faucet. Amount chosen by
 * the player, 0.01-0.5 SOL, once per UTC day.
 */
export async function POST(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }

  let sol: number;
  try {
    const body = await request.json();
    sol = Number(body?.sol);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const lamports = Math.floor((Number.isFinite(sol) ? sol : 0) * LAMPORTS_PER_SOL);

  try {
    const { lamports: credited, player } = await airdropSol(identity, lamports);
    return NextResponse.json({ ok: true, lamports: credited, player });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
