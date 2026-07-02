import { NextResponse } from "next/server";
import { getLiveState } from "@/lib/live";
import { savePick } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * POST /api/game/pick
 *   { identity, fixtureId, round, choice, home, away }
 *
 * Validates the choice against a freshly built card (server recomputes the
 * odds at pick time) and stores the prediction with that odds snapshot.
 */
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const identity = String(body?.identity ?? "").trim();
  const fixtureId = Number.parseInt(String(body?.fixtureId), 10);
  const round = Number.parseInt(String(body?.round), 10);
  const choice = String(body?.choice ?? "");
  const home = String(body?.home ?? "Home");
  const away = String(body?.away ?? "Away");

  if (!identity || !Number.isFinite(fixtureId) || !Number.isFinite(round) || !choice) {
    return NextResponse.json(
      { ok: false, error: "identity, fixtureId, round and choice are required." },
      { status: 400 },
    );
  }

  try {
    const live = await getLiveState(fixtureId);
    const { pick, card } = await savePick({
      identity,
      live,
      names: { home, away },
      round,
      choice,
    });
    return NextResponse.json({ ok: true, pick, round: card.round });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
