// Server-only replay support: fetch a finished match's historical scores
// (/scores/historical/{fixtureId}) and odds (/odds/updates/{fixtureId}),
// normalize them into clock-keyed frames. Pure playback/state logic lives
// in lib/replay-core.ts; payload parsing (matched to the REAL feed shapes)
// lives in lib/txline-parse.ts.

import { txlineGet } from "@/lib/txline";
import { scoreEntryFrames, all1X2, parseMatchOddsPayload } from "@/lib/txline-parse";
import type { ReplayTimeline, ScoreFrame, OddsFrame } from "@/lib/replay-core";

export { stateAt } from "@/lib/replay-core";
export type { ReplayTimeline, ScoreFrame, OddsFrame } from "@/lib/replay-core";

// Historical data is immutable; cache it for the process lifetime.
const cache = new Map<number, ReplayTimeline>();

function parseScoreFrames(raw: unknown): ScoreFrame[] {
  return scoreEntryFrames(raw);
}

/** Map a wall-clock ms timestamp onto the match clock via the score frames. */
export function clockAtTs(scoreFrames: ScoreFrame[], ts: number): number {
  let t = 0;
  for (const f of scoreFrames) {
    if (f.ts !== 0 && f.ts <= ts) t = f.t;
    else if (f.ts > ts) break;
  }
  return t;
}

/** Clock-keyed 1X2 odds frames from a raw odds updates/snapshot payload. */
export function parseOddsFrames(raw: unknown, scoreFrames: ScoreFrame[]): OddsFrame[] {
  const frames: OddsFrame[] = [];
  for (const p of all1X2(raw)) {
    const parsed = parseMatchOddsPayload(p);
    if (!parsed.prob || !parsed.odds) continue;
    frames.push({
      t: clockAtTs(scoreFrames, Number(p.Ts) || 0),
      prob: parsed.prob,
      odds: parsed.odds,
      bookmaker: parsed.bookmaker,
    });
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

export async function getReplayTimeline(fixtureId: number): Promise<ReplayTimeline> {
  const hit = cache.get(fixtureId);
  if (hit) return hit;

  const [scoresRaw, oddsRaw] = await Promise.allSettled([
    txlineGet(`/scores/historical/${fixtureId}`),
    txlineGet(`/odds/updates/${fixtureId}`),
  ]);

  if (scoresRaw.status === "rejected") {
    throw new Error(
      `No historical scores for fixture ${fixtureId} (replay covers matches started 2 weeks to 6 hours ago). ${scoresRaw.reason?.message ?? ""}`,
    );
  }

  const scoreFrames = parseScoreFrames(scoresRaw.value);
  if (scoreFrames.length === 0) {
    throw new Error(`Historical feed for fixture ${fixtureId} came back empty.`);
  }
  const oddsFrames = parseOddsFrames(
    oddsRaw.status === "fulfilled" ? oddsRaw.value : null,
    scoreFrames,
  );

  const timeline: ReplayTimeline = {
    fixtureId,
    duration: scoreFrames[scoreFrames.length - 1].t,
    scoreFrames,
    oddsFrames,
  };
  cache.set(fixtureId, timeline);
  return timeline;
}
