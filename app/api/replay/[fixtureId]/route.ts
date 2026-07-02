import { NextResponse } from "next/server";
import { getReplayTimeline } from "@/lib/replay";

export const dynamic = "force-dynamic";

/**
 * GET /api/replay/{fixtureId}
 *
 * Full normalized timeline (score frames + odds frames) for a finished
 * match, for client-side playback. TxLINE tokens stay server-side; the
 * historical fetch happens once and is cached.
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
    const timeline = await getReplayTimeline(fixtureId);
    return NextResponse.json({ ok: true, timeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
