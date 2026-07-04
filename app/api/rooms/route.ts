import { NextResponse } from "next/server";
import { createRoom, joinRoom, myRooms } from "@/lib/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms
 *   { identity, name }            -> create a room (creator auto-joins)
 *   { identity, code }            -> join a room by 6-char code
 * GET  /api/rooms?identity=..     -> rooms the player belongs to
 */
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const identity = String(body?.identity ?? "").trim();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "identity is required." }, { status: 400 });
  }

  try {
    if (body?.code) {
      const room = await joinRoom(identity, String(body.code));
      return NextResponse.json({ ok: true, room, joined: true });
    }
    const room = await createRoom(identity, String(body?.name ?? ""));
    return NextResponse.json({ ok: true, room, created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Room action failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const identity = new URL(request.url).searchParams.get("identity")?.trim();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "identity is required." }, { status: 400 });
  }
  try {
    const rooms = await myRooms(identity);
    return NextResponse.json({ ok: true, rooms });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load rooms.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
