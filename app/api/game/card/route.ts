import { NextResponse } from "next/server";
import { getLiveState } from "@/lib/live";
import { buildCard, settleDue } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * GET /api/game/card?fixtureId=..&home=..&away=..&identity=..
 *
 * Returns the current prediction card for the fixture. When an identity is
 * given, also settles that player's due predictions first and reports the
 * results (points won, streak changes) plus the fresh player row.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = Number.parseInt(searchParams.get("fixtureId") ?? "", 10);
  const home = searchParams.get("home") ?? "Home";
  const away = searchParams.get("away") ?? "Away";
  const identity = searchParams.get("identity");

  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid fixture id." }, { status: 400 });
  }

  try {
    const live = await getLiveState(fixtureId);
    const card = buildCard(live, { home, away });

    let settled: unknown[] = [];
    let player: unknown = null;
    let warning: string | undefined;
    if (identity) {
      try {
        const res = await settleDue(identity, live);
        settled = res.settled;
        player = res.player;
      } catch (err) {
        // Settlement needs Supabase; the card itself does not. Degrade politely.
        warning = err instanceof Error ? err.message : "Settlement unavailable.";
      }
    }

    return NextResponse.json({ ok: true, card, settled, player, warning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
