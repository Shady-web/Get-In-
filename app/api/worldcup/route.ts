import { NextResponse } from "next/server";
import { txlineGet } from "@/lib/txline";
import { getLiveState } from "@/lib/live";
import { isFinal } from "@/lib/game-core";

// Live sports data - never statically cache this route.
export const dynamic = "force-dynamic";

interface Fixture {
  StartTime: number;
  FixtureId: number;
  [key: string]: unknown;
}

/** Fixtures whose real status is worth checking against the scores feed. */
const CHECK_BEFORE_MS = 30 * 60_000; // starting within 30 min
const CHECK_AFTER_MS = 8 * 60 * 60_000; // started up to 8h ago (ET + pens safe)

/**
 * GET /api/worldcup
 *   Optional query: ?competitionId=<id>
 *
 * Fixtures schedule, augmented with the REAL match status drawn from the
 * scores feed (StartTime alone lies: matches run long into extra time and
 * penalties, and kickoffs shift). Each fixture gains:
 *   LiveStatus: "live" | "upcoming" | "finished"
 *   Phase:      human label ("Penalties", "Full time", ...)
 *   LiveScore:  { home, away } | null
 *
 * The browser calls THIS route; the route talks to TxLINE server-side using
 * the API token, which never leaves the server.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const competitionId = searchParams.get("competitionId");
  const path = competitionId
    ? `/fixtures/snapshot?competitionId=${encodeURIComponent(competitionId)}`
    : "/fixtures/snapshot";

  try {
    const data = await txlineGet<Fixture[]>(path);
    const fixtures = Array.isArray(data) ? data : [];
    const now = Date.now();

    // Only fixtures near their window need a real check; the rest are
    // safely classified by time alone.
    const candidates = fixtures.filter(
      (f) =>
        f.StartTime <= now + CHECK_BEFORE_MS && now - f.StartTime <= CHECK_AFTER_MS,
    );
    const states = await Promise.allSettled(
      candidates.map((f) => getLiveState(f.FixtureId)),
    );
    const stateById = new Map(
      states.flatMap((s, i) =>
        s.status === "fulfilled" ? [[candidates[i].FixtureId, s.value] as const] : [],
      ),
    );

    const augmented = fixtures.map((f) => {
      const s = stateById.get(f.FixtureId);
      let status: "live" | "upcoming" | "finished";
      if (s && s.statusId && s.statusId !== "NS") {
        status = isFinal(s.statusId) ? "finished" : "live";
      } else if (f.StartTime > now) {
        status = "upcoming";
      } else if (s?.statusId === "NS" && now - f.StartTime <= 60 * 60_000) {
        // Listed as started but the feed says not kicked off yet (delays).
        status = "upcoming";
      } else {
        // No live status from the feed: anything past ~4h is over.
        status = now - f.StartTime > 4 * 60 * 60_000 ? "finished" : "upcoming";
      }
      return {
        ...f,
        LiveStatus: status,
        Phase: s?.phase ?? null,
        LiveScore: s?.score ?? null,
      };
    });

    return NextResponse.json({ ok: true, count: augmented.length, data: augmented });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // 502: we reached our own server fine, but the upstream TxLINE call failed.
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
