import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { convertCoinsToSol } from "@/lib/rewards";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/convert { coins }  (authenticated)
 *
 * Converts the caller's leftover GI coins into spendable/withdrawable SOL at
 * the fixed peg, drawn from the house reserve. Lets a player sweep coins into
 * SOL before withdrawing.
 */
export async function POST(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }

  let coins: number;
  try {
    const body = await request.json();
    coins = Number(body?.coins);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await convertCoinsToSol(identity, coins);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Conversion failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
