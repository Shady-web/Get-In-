import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrCreatePlayer, isFinal } from "@/lib/game";
import { getLiveState } from "@/lib/live";
import {
  placeSlip,
  settleSlipsForMatch,
  voidStaleReplayLegs,
  withCashValues,
  type LegInput,
  type SlipRow,
} from "@/lib/betting";

export const dynamic = "force-dynamic";

/**
 * POST /api/slips { identity, stake, legs: [{fixtureId, marketKey,
 *   outcomeName, outcomeLabel, session?, vt?}] }
 *
 * Places a slip: one leg = single, several legs (can span matches) =
 * accumulator with combined odds = product of leg odds. The server
 * re-resolves every price; the client's displayed odds are advisory.
 */
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
  const stake = Number(body?.stake);
  const legs = Array.isArray(body?.legs) ? (body.legs as LegInput[]) : [];
  const currency = body?.currency === "SOL" ? "SOL" : "COIN";

  try {
    const { slip, player } = await placeSlip({ identity, stake, legs, currency });
    return NextResponse.json({ ok: true, slip, player });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not place the bet.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/**
 * GET /api/slips?identity=..
 *
 * The player's recent slips (with legs). Settles any due LIVE legs first
 * and voids abandoned replay legs, so this list is always fresh.
 */
export async function GET(request: Request) {
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

    // Settle due live legs (finished matches), match by match.
    const { data: pendingLegs } = await supabase
      .from("bet_legs")
      .select("match_id, fixture_id, session, bet_slips!inner(player)")
      .eq("result", "pending")
      .is("session", null)
      .eq("bet_slips.player", player.id);
    const liveMatches = [
      ...new Map(
        (pendingLegs ?? []).map((l: any) => [l.match_id, l.fixture_id as number]),
      ),
    ];
    for (const [matchId, fixtureId] of liveMatches) {
      try {
        const state = await getLiveState(fixtureId);
        if (isFinal(state.statusId)) {
          await settleSlipsForMatch(identity, matchId, state);
        }
      } catch {
        // Feed hiccup: leave those legs pending for the next look.
      }
    }
    await voidStaleReplayLegs(identity);

    const { data: slips, error } = await supabase
      .from("bet_slips")
      .select("*, bet_legs(*)")
      .eq("player", player.id)
      .order("placed_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    // Live cash-out value on every open slip, priced from current markets.
    const priced = await withCashValues((slips ?? []) as SlipRow[]);

    const fresh = await getOrCreatePlayer(identity);
    return NextResponse.json({ ok: true, slips: priced, player: fresh });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load slips.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
