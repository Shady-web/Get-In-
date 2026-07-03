import { NextResponse } from "next/server";
import { getMarkets } from "@/lib/markets";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/{fixtureId}
 *
 * Every market TxLINE currently prices for this fixture, normalized from
 * the raw odds snapshot (real keys, latest payload per market). The browser
 * polls this route; tokens never leave the server.
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
    const markets = await getMarkets(fixtureId);
    return NextResponse.json({ ok: true, markets, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
