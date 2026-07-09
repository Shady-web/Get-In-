import { NextResponse } from "next/server";
import { getMatchStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/{fixtureId}
 *
 * Recent form for both teams in a matchup: each side's last 3 finished
 * results (W/D/L + scores), assembled from the fixtures schedule and the
 * per-fixture final scores. Degrades to empty form when the feed can't
 * supply enough finished history.
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
    const stats = await getMatchStats(fixtureId);
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stats unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
