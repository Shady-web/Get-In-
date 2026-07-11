import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { getOrCreatePlayer } from "@/lib/game";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/delete  (authenticated)
 *
 * Permanently deletes the caller's account: the players row (which cascades
 * to their wallet, ledger, bets, badges and quest claims) and the Supabase
 * auth user. Irreversible - the client confirms before calling this.
 */
export async function POST(request: Request) {
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
    // Deleting the player row cascades to wallet, ledger, bets and everything
    // else keyed to it (all FKs are ON DELETE CASCADE).
    const { error: delErr } = await supabase.from("players").delete().eq("id", player.id);
    if (delErr) throw new Error(delErr.message);

    // Remove the auth user too so the email/username frees up. Best-effort:
    // the game data is already gone, so don't fail the request if this hiccups.
    try {
      await supabase.auth.admin.deleteUser(identity);
    } catch (authErr) {
      console.warn(
        `[account] player deleted but auth user ${identity} remains: ${
          authErr instanceof Error ? authErr.message : "unknown"
        }`,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not delete the account.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
