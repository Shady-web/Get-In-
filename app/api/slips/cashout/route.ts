import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { cashOutSlip } from "@/lib/betting";

export const dynamic = "force-dynamic";

/**
 * POST /api/slips/cashout { identity, slipId }
 *
 * Cashes an open slip out at its CURRENT value, recomputed server-side at
 * confirm time (potential return x product of pending legs' implied
 * probabilities x 0.95). Credits coins and marks the slip "cashed".
 */
export async function POST(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
  let slipId: string;
  try {
    slipId = String((await request.json())?.slipId ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!slipId) {
    return NextResponse.json({ ok: false, error: "slipId is required." }, { status: 400 });
  }

  try {
    const { amount, player } = await cashOutSlip(identity, slipId);
    return NextResponse.json({ ok: true, amount, player });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cash out failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
