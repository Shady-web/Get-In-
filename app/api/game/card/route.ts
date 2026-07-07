import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getLiveState } from "@/lib/live";
import { buildCard, settleDue } from "@/lib/game";
import { getReplayTimeline, stateAt } from "@/lib/replay";
import { settleSlipsForMatch } from "@/lib/betting";

export const dynamic = "force-dynamic";

const SESSION_RE = /^r\d+-[a-z0-9]{4,24}$/;

/**
 * GET /api/game/card?fixtureId=..&home=..&away=..&identity=..
 *   Replay mode adds: &session=r{fixtureId}-{nonce}&vt={virtualClockSeconds}
 *
 * Returns the current prediction card. With an identity, also settles that
 * player's due predictions first (against live state, or the synthesized
 * historical state at vt during replay) and reports results + player row.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = Number.parseInt(searchParams.get("fixtureId") ?? "", 10);
  const home = searchParams.get("home") ?? "Home";
  const away = searchParams.get("away") ?? "Away";
  const session = searchParams.get("session");
  const vtRaw = searchParams.get("vt");

  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid fixture id." }, { status: 400 });
  }
  if (session && !SESSION_RE.test(session)) {
    return NextResponse.json({ ok: false, error: "Invalid replay session." }, { status: 400 });
  }

  // The card itself is public; settlement runs only for signed-in callers.
  let identity: string | null = null;
  try {
    identity = (await requireUser(request)).userId;
  } catch {
    identity = null;
  }

  try {
    let state;
    let matchId: string;
    if (session) {
      const vt = Math.max(0, Number.parseFloat(vtRaw ?? "0") || 0);
      const timeline = await getReplayTimeline(fixtureId);
      state = stateAt(timeline, vt);
      matchId = session;
    } else {
      state = await getLiveState(fixtureId);
      matchId = String(fixtureId);
    }

    const card = buildCard(state, { home, away });

    let settled: unknown[] = [];
    let slipResults: unknown[] = [];
    let player: unknown = null;
    let warning: string | undefined;
    if (identity) {
      try {
        const res = await settleDue(identity, state, matchId);
        settled = res.settled;
        player = res.player;
        // Coin slips settle from the same state; replay virtual time drives
        // this too, since `state` is synthesized at vt during replays.
        const slips = await settleSlipsForMatch(identity, matchId, state);
        slipResults = slips.results;
        if (slips.player) player = slips.player;
      } catch (err) {
        // Settlement needs Supabase; the card itself does not. Degrade politely.
        warning = err instanceof Error ? err.message : "Settlement unavailable.";
      }
    }

    return NextResponse.json({ ok: true, card, settled, slipResults, player, warning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
