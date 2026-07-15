import { NextResponse } from "next/server";
import { getScoresSnapshot } from "@/lib/scores-snapshot";
import { scoreEntryFrames } from "@/lib/txline-parse";
import { buildMatchEvents } from "@/lib/match-events";
import { getLiveState } from "@/lib/live";
import { txlineGet } from "@/lib/txline";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/{fixtureId}
 *
 * The live match feed: goals and cards that have happened so far, built from
 * the live scores history (named from the incidents feed when it carries the
 * players). Returns the current match clock too, so the client can label the
 * feed. Best-effort and public, like the scores it reads.
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
    const [snap, incidents, live] = await Promise.allSettled([
      getScoresSnapshot(fixtureId),
      txlineGet(`/scores/incidents/${fixtureId}`),
      getLiveState(fixtureId),
    ]);
    const frames = snap.status === "fulfilled" ? scoreEntryFrames(snap.value) : [];
    const incidentsRaw = incidents.status === "fulfilled" ? incidents.value : null;
    const events = buildMatchEvents(frames, incidentsRaw);
    const clockSeconds =
      live.status === "fulfilled" ? Math.max(0, Math.floor(live.value.clockSeconds ?? 0)) : 0;
    const phase = live.status === "fulfilled" ? live.value.phase : null;
    return NextResponse.json({ ok: true, events, clockSeconds, phase });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Match feed unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
