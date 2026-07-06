import { NextResponse } from "next/server";
import { claimQuest, questBoard } from "@/lib/quests";

export const dynamic = "force-dynamic";

/** GET /api/quests?identity= : today's 3 quests with live progress. */
export async function GET(request: Request) {
  const identity = new URL(request.url).searchParams.get("identity")?.trim();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "identity is required." }, { status: 400 });
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
  const identity = body.identity?.trim();
  const questId = body.questId?.trim();
  if (!identity || !questId) {
    return NextResponse.json(
      { ok: false, error: "identity and questId are required." },
      { status: 400 },
    );
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
