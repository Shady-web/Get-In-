import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
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
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
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
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
  try {
    const rooms = await myRooms(identity);
    return NextResponse.json({ ok: true, rooms });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load rooms.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
