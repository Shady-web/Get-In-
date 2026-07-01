import { NextResponse } from "next/server";
import { getLiveState } from "@/lib/live";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/{fixtureId}
 *
 * Latest live state (score, clock, win probabilities) for one fixture.
 * The browser polls THIS route every ~7s; the server polls TxLINE (with a
 * matching cache) so tokens never leave the server and TxLINE sees at most
 * one request per fixture per cycle.
 */
export async function GET(
  _request: Request,
  { params }: { params: { fixtureId: string } },
) {
  const fixtureId = Number.parseInt(params.fixtureId, 10);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid fixture id." }, { status: 400 });
  }

  try {
    const state = await getLiveState(fixtureId);
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
