import { NextResponse } from "next/server";
import { askPunditNow, getPunditFeed } from "@/lib/pundit";
import { getReplayTimeline } from "@/lib/replay";
import { stateAt } from "@/lib/replay-core";
import { getLiveState } from "@/lib/live";

export const dynamic = "force-dynamic";

const minuteOf = (t: number) => (t <= 0 ? 0 : Math.max(1, Math.ceil(t / 60)));

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

/**
 * POST /api/pundit/{fixtureId}   body { home, away, vt? }
 *
 * On-demand pundit: asks the AI for its read of the current moment. `vt` set
 * (replay clock seconds) reads the state from the historical timeline at that
 * scrub position; omitted reads the live state now. The server derives score /
 * minute / market itself so the client can't spoof them.
 */
export async function POST(
  request: Request,
  { params }: { params: { fixtureId: string } },
) {
  const fixtureId = Number.parseInt(params.fixtureId, 10);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid fixture id." }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const home = String(body?.home ?? "Home").slice(0, 40);
  const away = String(body?.away ?? "Away").slice(0, 40);
  const vt = body?.vt === undefined || body?.vt === null ? null : Number(body.vt);
  if (vt !== null && !Number.isFinite(vt)) {
    return NextResponse.json({ ok: false, error: "Invalid vt." }, { status: 400 });
  }

  try {
    let minute: number;
    let score: { home: number; away: number };
    let prob: { home: number; draw: number; away: number } | null;
    if (vt !== null) {
      const state = stateAt(await getReplayTimeline(fixtureId), vt);
      minute = minuteOf(vt);
      score = state.score ?? { home: 0, away: 0 };
      prob = state.prob;
    } else {
      const state = await getLiveState(fixtureId);
      minute = minuteOf(state.clockSeconds ?? 0);
      score = state.score ?? { home: 0, away: 0 };
      prob = state.prob;
    }
    const result = await askPunditNow({ fixtureId, teams: { home, away }, minute, score, prob });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pundit is unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
