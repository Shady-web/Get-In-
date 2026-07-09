import { NextResponse } from "next/server";
import { getMarkets, type Market } from "@/lib/markets";
import { getLiveState } from "@/lib/live";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/{fixtureId}
 *
 * Every market TxLINE currently prices for this fixture, normalized from
 * the raw odds snapshot. If the snapshot yields no Match Winner market but
 * the live state has 1X2 odds, we surface that winner market too - so any
 * game whose winner odds show on the scoreboard also has a bettable market
 * here, and the Markets tab isn't empty when it shouldn't be.
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
    const [markets, live] = await Promise.all([
      getMarkets(fixtureId),
      getLiveState(fixtureId).catch(() => null),
    ]);

    const hasWinner = markets.some((m) => m.superType.toUpperCase().includes("1X2"));
    if (!hasWinner && live?.odds) {
      const winner: Market = {
        key: "1X2_PARTICIPANT_RESULT||",
        superType: "1X2_PARTICIPANT_RESULT",
        period: null,
        params: null,
        label: "Match winner",
        periodLabel: "Full time",
        bookmaker: live.bookmaker,
        ts: live.fetchedAt,
        outcomes: [
          { name: "part1", price: live.odds.home, pct: live.prob?.home ?? null },
          { name: "draw", price: live.odds.draw, pct: live.prob?.draw ?? null },
          { name: "part2", price: live.odds.away, pct: live.prob?.away ?? null },
        ],
      };
      markets.unshift(winner);
    }

    return NextResponse.json({ ok: true, markets, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
