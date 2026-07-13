import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrCreatePlayer } from "@/lib/game";
import { getFixtureScore, type FixtureScore } from "@/lib/final-score";
import { txlineGet } from "@/lib/txline";

export const dynamic = "force-dynamic";

/**
 * GET /api/slips/{slipId}  (authenticated)
 *
 * Full detail for one of the caller's bet slips: stake, combined odds, return,
 * and per-leg the match, full-time (or live) score, the market, the pick with
 * its odds, and whether that leg won/lost/voided. Used by the My Bets ticket
 * view.
 */
export async function GET(
  request: Request,
  { params }: { params: { slipId: string } },
) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  try {
    const player = await getOrCreatePlayer(identity);
    const { data: slip } = await supabase
      .from("bet_slips")
      .select("*, bet_legs(*)")
      .eq("id", params.slipId)
      .eq("player", player.id)
      .single();
    if (!slip) {
      return NextResponse.json({ ok: false, error: "Slip not found." }, { status: 404 });
    }

    const legs = (slip.bet_legs ?? []) as any[];

    // Fetch the score for each distinct LIVE fixture (replay legs carry a
    // session and their fixture is only meaningful inside the replay).
    const fixtureIds = [
      ...new Set(
        legs.filter((l) => !l.session && l.fixture_id).map((l) => l.fixture_id as number),
      ),
    ];
    // Scores per fixture, plus each fixture's scheduled kickoff (so the ticket
    // can show "Pre-match · kicks off ..." and hide the score before a match
    // starts). The fixtures snapshot is best-effort; a miss just omits kickoff.
    const [scoreEntries, kickoffs] = await Promise.all([
      Promise.all(
        fixtureIds.map(async (id) => [id, await getFixtureScore(id).catch(() => null)] as const),
      ),
      txlineGet<any[]>("/fixtures/snapshot").catch(() => [] as any[]),
    ]);
    const scores = new Map<number, FixtureScore | null>(scoreEntries);
    const startById = new Map<number, number>();
    for (const f of Array.isArray(kickoffs) ? kickoffs : []) {
      if (f?.FixtureId != null && f?.StartTime != null) {
        startById.set(Number(f.FixtureId), Number(f.StartTime));
      }
    }

    const detailLegs = legs.map((l) => {
      const label = String(l.outcome_label ?? "");
      const sep = label.indexOf(": ");
      const matchLabel = sep > 0 ? label.slice(0, sep) : "";
      const pick = sep > 0 ? label.slice(sep + 2) : label;
      const score = l.session ? null : scores.get(l.fixture_id as number) ?? null;
      const kickoff = l.session ? null : startById.get(l.fixture_id as number) ?? null;
      return {
        id: l.id as string,
        matchLabel,
        pick,
        marketLabel: String(l.market_label ?? "Match winner"),
        odds: Number(l.odds ?? 0),
        result: String(l.result ?? "pending"),
        session: Boolean(l.session),
        score, // { home, away, final } | null
        kickoff, // scheduled StartTime ms | null
      };
    });

    return NextResponse.json({
      ok: true,
      slip: {
        id: slip.id,
        stake: Number(slip.stake ?? 0),
        combined_odds: Number(slip.combined_odds ?? 0),
        potential_return: Number(slip.potential_return ?? 0),
        cashout_amount: slip.cashout_amount == null ? null : Number(slip.cashout_amount),
        status: String(slip.status ?? "pending"),
        currency: slip.currency === "SOL" ? "SOL" : "COIN",
        placed_at: slip.placed_at ?? null,
        settled_at: slip.settled_at ?? null,
        legs: detailLegs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the slip.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
