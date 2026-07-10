import { NextResponse } from "next/server";
import { getMarkets, type Market } from "@/lib/markets";
import { getLiveState } from "@/lib/live";
import { isFinal } from "@/lib/game-core";
import { winnerOdds } from "@/lib/odds";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/{fixtureId}
 *
 * Every market TxLINE currently prices for this fixture, normalized from the
 * raw odds snapshot. If the snapshot has no Match Winner market and the match
 * hasn't finished, we ALWAYS surface a winner market anyway - real 1X2 odds
 * when the feed has them, else derived from the win probabilities, else flat
 * indicative prices. That guarantees every upcoming or live match you can
 * open is bettable, even before a bookmaker opens a book.
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
    // Neither call should be able to blank the winner market: a flaky odds
    // snapshot must still leave you a bettable Match Winner below.
    const [markets, live] = await Promise.all([
      getMarkets(fixtureId).catch(() => [] as Market[]),
      getLiveState(fixtureId).catch(() => null),
    ]);

    const hasWinner = markets.some((m) => m.superType.toUpperCase().includes("1X2"));
    // Synthesize a Match Winner for any match that hasn't finished (including
    // when the live fetch failed entirely - a flat default still lets you bet).
    const finished = live ? isFinal(live.statusId) : false;
    if (!hasWinner && !finished) {
      const wo = winnerOdds(live ?? {});
      const winner: Market = {
        key: "1X2_PARTICIPANT_RESULT||",
        superType: "1X2_PARTICIPANT_RESULT",
        period: null,
        params: null,
        label: "Match winner",
        periodLabel: "Full time",
        bookmaker: live?.bookmaker ?? null,
        ts: live?.fetchedAt ?? Date.now(),
        outcomes: [
          { name: "part1", price: wo.home, pct: live?.prob?.home ?? null },
          { name: "draw", price: wo.draw, pct: live?.prob?.draw ?? null },
          { name: "part2", price: wo.away, pct: live?.prob?.away ?? null },
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
