// Server-only replay support: fetch a finished match's historical scores
// (/scores/historical/{fixtureId}) and odds (/odds/updates/{fixtureId}),
// normalize them into clock-keyed frames. Pure playback/state logic lives
// in lib/replay-core.ts, shared with the browser.

import { txlineGet } from "@/lib/txline";
import type { ReplayTimeline, ScoreFrame, OddsFrame } from "@/lib/replay-core";

export { stateAt } from "@/lib/replay-core";
export type { ReplayTimeline, ScoreFrame, OddsFrame } from "@/lib/replay-core";

// Historical data is immutable; cache it for the process lifetime.
const cache = new Map<number, ReplayTimeline>();

function statusToString(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw as object);
    if (keys.length > 0) return keys[0];
  }
  return null;
}

const HOME_NAMES = new Set(["1", "home", "h"]);
const DRAW_NAMES = new Set(["x", "draw", "d"]);
const AWAY_NAMES = new Set(["2", "away", "a"]);

function parseScoreFrames(raw: unknown): ScoreFrame[] {
  if (!Array.isArray(raw)) return [];
  const frames: ScoreFrame[] = [];
  let last: ScoreFrame | null = null;

  for (const entry of raw) {
    const u = (entry as any)?.data ?? entry;
    if (!u || typeof u !== "object") continue;

    const clock = typeof u.clock?.seconds === "number" ? u.clock.seconds : last?.t;
    if (clock === undefined) continue;

    const g1 = u.scoreSoccer?.Participant1?.Total?.Goals;
    const g2 = u.scoreSoccer?.Participant2?.Total?.Goals;
    const c1 = u.scoreSoccer?.Participant1?.Total?.Corners;
    const c2 = u.scoreSoccer?.Participant2?.Total?.Corners;

    const frame: ScoreFrame = {
      t: clock,
      ts: typeof u.ts === "number" ? u.ts : (last?.ts ?? 0),
      score:
        typeof g1 === "number" && typeof g2 === "number"
          ? { home: g1, away: g2 }
          : (last?.score ?? { home: 0, away: 0 }),
      corners:
        typeof c1 === "number" && typeof c2 === "number"
          ? c1 + c2
          : (last?.corners ?? 0),
      statusId: statusToString(u.statusSoccerId) ?? last?.statusId ?? null,
    };
    frames.push(frame);
    last = frame;
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

/** Map a wall-clock ms timestamp onto the match clock via the score frames. */
function clockAtTs(scoreFrames: ScoreFrame[], ts: number): number {
  let t = 0;
  for (const f of scoreFrames) {
    if (f.ts !== 0 && f.ts <= ts) t = f.t;
    else if (f.ts > ts) break;
  }
  return t;
}

function parseOddsFrames(raw: unknown, scoreFrames: ScoreFrame[]): OddsFrame[] {
  if (!Array.isArray(raw)) return [];
  const frames: OddsFrame[] = [];

  for (const entry of raw) {
    const p = (entry as any)?.data ?? entry;
    if (!p || !Array.isArray(p.PriceNames) || p.PriceNames.length !== 3) continue;
    const period = String(p.MarketPeriod ?? "").toLowerCase();
    if (!(period === "" || period === "ft" || period.includes("full"))) continue;

    const idx = { home: 0, draw: 1, away: 2 };
    p.PriceNames.forEach((name: unknown, i: number) => {
      const n = String(name ?? "").toLowerCase();
      if (HOME_NAMES.has(n)) idx.home = i;
      else if (DRAW_NAMES.has(n)) idx.draw = i;
      else if (AWAY_NAMES.has(n)) idx.away = i;
    });

    let implied: number[] | null = null;
    if (Array.isArray(p.Pct) && p.Pct.length === 3) {
      const vals = p.Pct.map((s: unknown) => Number.parseFloat(String(s)));
      if (vals.every((v: number) => Number.isFinite(v) && v > 0)) implied = vals;
    }
    if (!implied && Array.isArray(p.Prices) && p.Prices.length === 3) {
      const vals = p.Prices.map((x: unknown) => {
        const odds = Number(x) / 1000;
        return odds > 1 ? 100 / odds : NaN;
      });
      if (vals.every((v: number) => Number.isFinite(v) && v > 0)) implied = vals;
    }
    if (!implied) continue;

    const sum = implied[0] + implied[1] + implied[2];
    const pct = (i: number) => Math.round((implied![i] / sum) * 1000) / 10;
    const home = pct(idx.home);
    const draw = pct(idx.draw);
    const away = Math.round((100 - home - draw) * 10) / 10;

    const decimal = (i: number): number => {
      const price = Array.isArray(p.Prices) ? Number(p.Prices[i]) : NaN;
      if (Number.isFinite(price) && price >= 1010 && price <= 1_000_000) {
        return Math.round(price) / 1000;
      }
      return Math.round((100 / implied![i]) * 100) / 100;
    };

    frames.push({
      t: clockAtTs(scoreFrames, Number(p.Ts) || 0),
      prob: { home, draw, away },
      odds: { home: decimal(idx.home), draw: decimal(idx.draw), away: decimal(idx.away) },
      bookmaker: p.Bookmaker ?? null,
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
