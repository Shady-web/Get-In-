import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/player   { identity: string, kind: "wallet" | "guest" }
 *
 * Upserts the player by wallet_or_nickname and returns the row. If Supabase
 * isn't configured yet, sign-in still works locally — we return player: null
 * with a warning so the shell stays usable before the DB exists.
 */
export async function POST(request: Request) {
  let identity: string;
  let kind: string;
  try {
    const body = await request.json();
    identity = String(body?.identity ?? "").trim();
    kind = String(body?.kind ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (kind !== "wallet" && kind !== "guest") {
    return NextResponse.json({ error: "kind must be wallet or guest." }, { status: 400 });
  }
  if (kind === "guest" && (identity.length < 2 || identity.length > 20)) {
    return NextResponse.json(
      { error: "Nickname needs to be 2–20 characters." },
      { status: 400 },
    );
  }
  if (kind === "wallet" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(identity)) {
    return NextResponse.json({ error: "That doesn’t look like a Solana address." }, {
      status: 400,
    });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      player: null,
      warning:
        "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing) — player not persisted.",
    });
  }

  const { data, error } = await supabase
    .from("players")
    .upsert(
      { wallet_or_nickname: identity },
      { onConflict: "wallet_or_nickname", ignoreDuplicates: false },
    )
    .select("id, wallet_or_nickname, total_points, best_streak")
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Could not save player: ${error.message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ player: data });
}
