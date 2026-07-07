import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cleanUsername } from "@/lib/game";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register { email, username, password }
 *
 * Creates the Supabase Auth user with the chosen username in its metadata
 * (email confirmation is skipped: hackathon build). The client signs in
 * with the password right after. Username uniqueness is checked against
 * players up front so the taken-name error arrives before account creation.
 */
export async function POST(request: Request) {
  let email: string;
  let username: string;
  let password: string;
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    username = cleanUsername(String(body?.username ?? ""));
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "That email doesn't look right." }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json(
      { ok: false, error: "Username: 3-20 characters, letters/numbers/underscore." },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, error: "Password needs at least 6 characters." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  const { data: taken } = await supabase
    .from("players")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (taken) {
    return NextResponse.json({ ok: false, error: "That username is taken." }, { status: 409 });
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (error) {
    const message = /already/i.test(error.message)
      ? "An account with that email already exists. Sign in instead."
      : `Could not create the account: ${error.message}`;
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
