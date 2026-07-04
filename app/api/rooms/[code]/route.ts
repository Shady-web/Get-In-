import { NextResponse } from "next/server";
import { roomStandings } from "@/lib/rooms";

export const dynamic = "force-dynamic";

/** GET /api/rooms/{code}: room info + standings by profit since joining. */
export async function GET(
  _request: Request,
  { params }: { params: { code: string } },
) {
  if (!/^[A-Za-z0-9]{6}$/.test(params.code)) {
    return NextResponse.json({ ok: false, error: "Invalid room code." }, { status: 400 });
  }
  try {
    const { room, standings } = await roomStandings(params.code);
    return NextResponse.json({ ok: true, room, standings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the room.";
    const status = message.includes("No room") ? 404 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
