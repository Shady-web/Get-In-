import { NextResponse } from "next/server";
import { txlineGet } from "@/lib/txline";

// Live diagnostics - never cache.
export const dynamic = "force-dynamic";

interface Fixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
}

/**
 * GET /api/test
 *   Optional query: ?fixtureId=<id>  (skip auto-pick and use this fixture)
 *
 * End-to-end TxLINE health check, all server-side:
 *   1. fetch the fixtures schedule   GET /fixtures/snapshot
 *   2. fetch historical scores for one past fixture
 *                                    GET /scores/updates/{fixtureId}
 * Returns a small JSON summary of both calls.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const overrideId = searchParams.get("fixtureId");

  try {
    // --- 1) fixtures schedule -----------------------------------------
    const fixtures = await txlineGet<Fixture[]>("/fixtures/snapshot");
    if (!Array.isArray(fixtures) || fixtures.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Fixtures snapshot returned no fixtures." },
        { status: 502 },
      );
    }

    // --- 2) pick one PAST fixture (already kicked off) ------------------
    const now = Date.now();
    const past = fixtures
      .filter((f) => f.StartTime < now)
      .sort((a, b) => b.StartTime - a.StartTime); // most recent first

    const target = overrideId
      ? fixtures.find((f) => String(f.FixtureId) === overrideId) ?? {
          FixtureId: Number(overrideId),
        }
      : past[0];

    let scores: unknown = null;
    let scoresError: string | null = null;
    let scoresCount: number | undefined;

    if (!target) {
      scoresError =
        "No fixture has started yet (all StartTimes are in the future), so there are no historical scores to fetch. Pass ?fixtureId=<id> to force one.";
    } else {
      try {
        scores = await txlineGet(`/scores/updates/${target.FixtureId}`);
        scoresCount = Array.isArray(scores) ? scores.length : undefined;
      } catch (err) {
        scoresError = err instanceof Error ? err.message : "Unknown scores error";
      }
    }

    // --- summary ---------------------------------------------------------
    const full = target && "Participant1" in target ? (target as Fixture) : null;
    return NextResponse.json({
      ok: scoresError === null,
      fixtures: {
        count: fixtures.length,
        competitions: [...new Set(fixtures.map((f) => f.Competition))],
        pastFixtures: past.length,
        sample: fixtures.slice(0, 2),
      },
      scores: {
        fixtureId: target?.FixtureId ?? null,
        match: full ? `${full.Participant1} vs ${full.Participant2}` : null,
        startTime: full ? new Date(full.StartTime).toISOString() : null,
        updateCount: scoresCount,
        updates: Array.isArray(scores) ? (scores as unknown[]).slice(0, 5) : scores,
        error: scoresError,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
