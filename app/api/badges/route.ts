import { NextResponse } from "next/server";
import { getBadges } from "@/lib/badges";

export const dynamic = "force-dynamic";

/**
 * GET /api/badges?identity= : the badge wall. Also AWARDS any badge whose
 * condition is already met (idempotent), so milestones count retroactively.
 */
export async function GET(request: Request) {
  const identity = new URL(request.url).searchParams.get("identity")?.trim();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "identity is required." }, { status: 400 });
  }
  try {
    const badges = await getBadges(identity);
    return NextResponse.json({ ok: true, badges });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load badges.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
