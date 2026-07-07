import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cleanUsername } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/lookup { username }
 *
 * Username -> email so the login form accepts either in one field
 * (Supabase Auth itself signs in by email). Only the email of an existing
 * username is returned; wrong names get a uniform error.
 */
export async function POST(request: Request) {
  let username: string;
  try {
    username = cleanUsername(String((await request.json())?.username ?? ""));
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json({ ok: false, error: "No account with that username." }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  const { data: player } = await supabase
    .from("players")
    .select("auth_user_id")
    .eq("username", username)
    .maybeSingle();
  if (!player?.auth_user_id) {
    return NextResponse.json({ ok: false, error: "No account with that username." }, { status: 404 });
  }

  const { data, error } = await supabase.auth.admin.getUserById(player.auth_user_id);
  if (error || !data?.user?.email) {
    return NextResponse.json({ ok: false, error: "No account with that username." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, email: data.user.email });
}
