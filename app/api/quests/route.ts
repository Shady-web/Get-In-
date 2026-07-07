import { NextResponse } from "next/server";
import { errorStatus, requireUser } from "@/lib/auth";
import { claimQuest, questBoard } from "@/lib/quests";

export const dynamic = "force-dynamic";

/** GET /api/quests?identity= : today's 3 quests with live progress. */
export async function GET(request: Request) {
  let identity: string;
  try {
    identity = (await requireUser(request)).userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in to do that.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(err) });
  }
  try {
    const board = await questBoard(identity);
    return NextResponse.json({ ok: true, ...board });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load quests.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

/** POST /api/quests {identity, questId}: claim a finished quest's coins. */
export async function POST(request: Request) {
  let body: { identity?: string; questId?: string };
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
  const questId = body.questId?.trim();
  if (!questId) {
    return NextResponse.json({ ok: false, error: "questId is required." }, { status: 400 });
  }
  try {
    const { reward, player } = await claimQuest(identity, questId);
    return NextResponse.json({ ok: true, reward, player });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not claim the quest.";
    const status = /not finished|Already claimed|not on today/.test(message) ? 409 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
