import { NextResponse } from "next/server";
import { txlineGet } from "@/lib/txline";

// Live sports data - never statically cache this route.
export const dynamic = "force-dynamic";

/**
 * GET /api/worldcup
 *   Optional query: ?competitionId=<id>
 *
 * The browser calls THIS route; the route talks to TxLINE server-side using the
 * API token, which never leaves the server.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const competitionId = searchParams.get("competitionId");
  const path = competitionId
    ? `/fixtures/snapshot?competitionId=${encodeURIComponent(competitionId)}`
    : "/fixtures/snapshot";

  try {
    const data = await txlineGet(path);
    const count = Array.isArray(data) ? data.length : undefined;
    return NextResponse.json({ ok: true, count, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // 502: we reached our own server fine, but the upstream TxLINE call failed.
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
