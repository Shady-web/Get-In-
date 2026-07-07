import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { getBadges } from "@/lib/badges";

export const dynamic = "force-dynamic";

/**
 * GET /api/badges?identity= : the badge wall. Also AWARDS any badge whose
 * condition is already met (idempotent), so milestones count retroactively.
 */
export async function GET(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
  try {
    const badges = await getBadges(identity);
    return NextResponse.json({ ok: true, badges });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load badges.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
