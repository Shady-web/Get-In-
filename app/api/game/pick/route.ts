import { NextResponse } from "next/server";
import { getLiveState } from "@/lib/live";
import { savePick } from "@/lib/game";
import { getReplayTimeline, stateAt } from "@/lib/replay";

export const dynamic = "force-dynamic";

const SESSION_RE = /^r\d+-[a-z0-9]{4,24}$/;

/**
 * POST /api/game/pick
 *   { identity, fixtureId, round, choice, home, away }
 *   Replay mode adds: { session: "r{fixtureId}-{nonce}", vt: seconds }
 *
 * Validates the choice against a freshly built card (server recomputes the
 * odds at pick time, live or at the replay's virtual clock) and stores the
 * prediction with that odds snapshot.
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
  const session = body?.session ? String(body.session) : null;

  if (!identity || !Number.isFinite(fixtureId) || !Number.isFinite(round) || !choice) {
    return NextResponse.json(
      { ok: false, error: "identity, fixtureId, round and choice are required." },
      { status: 400 },
    );
  }
  if (session && !SESSION_RE.test(session)) {
    return NextResponse.json({ ok: false, error: "Invalid replay session." }, { status: 400 });
  }

  try {
    let state;
    let matchId: string;
    if (session) {
      const vt = Math.max(0, Number.parseFloat(String(body?.vt ?? "0")) || 0);
      const timeline = await getReplayTimeline(fixtureId);
      state = stateAt(timeline, vt);
      matchId = session;
    } else {
      state = await getLiveState(fixtureId);
      matchId = String(fixtureId);
    }

    const { pick, card } = await savePick({
      identity,
      live: state,
      names: { home, away },
      matchId,
      round,
      choice,
    });
    return NextResponse.json({ ok: true, pick, round: card.round });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
