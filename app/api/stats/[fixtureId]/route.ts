import { NextResponse } from "next/server";
import { getMatchStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/{fixtureId}?home={name}&away={name}
 *
 * Recent form for both teams in a matchup: each side's last 5 finished
 * results (W/D/L + scores), assembled from the fixtures schedule and the
 * per-fixture final scores. The optional home/away names let the route
 * resolve matchups that aren't in the fixtures snapshot (replay / seeded /
 * pinned matches). Degrades to curated form when the feed has no history.
 */
export async function GET(
  request: Request,
  { params }: { params: { fixtureId: string } },
) {
  const fixtureId = Number.parseInt(params.fixtureId, 10);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid fixture id." }, { status: 400 });
  }
  const url = new URL(request.url);
  const home = url.searchParams.get("home") ?? undefined;
  const away = url.searchParams.get("away") ?? undefined;
  try {
    const stats = await getMatchStats(fixtureId, { home, away });
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stats unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
