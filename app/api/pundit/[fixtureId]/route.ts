import { NextResponse } from "next/server";
import { getPunditFeed } from "@/lib/pundit";

export const dynamic = "force-dynamic";

/**
 * GET /api/pundit/{fixtureId}?home=&away=[&vt=]
 *
 * The Pundit ticker feed: one-line AI hot takes generated ONLY when a goal,
 * a red card, or a >15-point win-probability swing happens (max 12 per
 * match, cached so replays never re-call the AI). `vt` (replay clock
 * seconds) switches to Replay Mode: takes appear as the scrubber passes
 * them. The Gemini key stays server-side, like every other secret.
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
  const home = (url.searchParams.get("home") ?? "Home").slice(0, 40);
  const away = (url.searchParams.get("away") ?? "Away").slice(0, 40);
  const vtRaw = url.searchParams.get("vt");
  const vt = vtRaw === null ? null : Number.parseFloat(vtRaw);
  if (vt !== null && !Number.isFinite(vt)) {
    return NextResponse.json({ ok: false, error: "Invalid vt." }, { status: 400 });
  }

  try {
    const feed = await getPunditFeed({
      fixtureId,
      teams: { home, away },
      replayVt: vt,
    });
    return NextResponse.json({ ok: true, ...feed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pundit feed unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
