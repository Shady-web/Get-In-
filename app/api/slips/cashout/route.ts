import { NextResponse } from "next/server";
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
  let slipId: string;
  try {
    const body = await request.json();
    identity = String(body?.identity ?? "").trim();
    slipId = String(body?.slipId ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!identity || !slipId) {
    return NextResponse.json(
      { ok: false, error: "identity and slipId are required." },
      { status: 400 },
    );
  }

  try {
    const { amount, player } = await cashOutSlip(identity, slipId);
    return NextResponse.json({ ok: true, amount, player });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cash out failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
