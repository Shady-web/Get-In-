import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getLiveState } from "@/lib/live";
import { getReplayTimeline, stateAt } from "@/lib/replay";
import { settleSlipsForMatch } from "@/lib/betting";

export const dynamic = "force-dynamic";

const SESSION_RE = /^r\d+-[a-z0-9]{4,24}$/;

/**
 * GET /api/settle?fixtureId=..[&session=r{fixtureId}-{nonce}&vt={seconds}]
 *
 * Settles the caller's due bet slips for one match against the current state
 * (live TxLINE state, or the synthesized historical state at vt during a
 * replay). Returns the settled results and the fresh player row. This is the
 * settlement heartbeat the replay view polls; live slips also settle from the
 * global My Bets poll and at read time in /api/slips.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureId = Number.parseInt(searchParams.get("fixtureId") ?? "", 10);
  const session = searchParams.get("session");
  const vtRaw = searchParams.get("vt");

  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid fixture id." }, { status: 400 });
  }
  if (session && !SESSION_RE.test(session)) {
    return NextResponse.json({ ok: false, error: "Invalid replay session." }, { status: 400 });
  }

  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
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

    const { results, player } = await settleSlipsForMatch(identity, matchId, state);
    return NextResponse.json({ ok: true, slipResults: results, player });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Settlement unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
