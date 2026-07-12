// Server-only Pundit engine: watches a match's event history and generates
// one-line AI hot takes ONLY when something take-worthy happens (a goal, a
// red card, or a 1X2 win-probability swing of more than 15 points).
//
// Events are derived deterministically from the SAME frame data live and in
// Replay Mode, so an event always maps to the same key (e.g. "goal:2-1",
// "red:home:1", "swing:home:44-62"). Takes are cached per (fixture, key) in
// memory and in Supabase: a replay of a match that was watched live is pure
// cache hits and never re-calls the AI. Hard cap: 12 takes per fixture.
//
// The AI is Google's Gemini (gemini-2.0-flash, free tier) called with a
// server-side key. If GEMINI_API_KEY is missing the feature disables itself.

import { txlineGet } from "@/lib/txline";
import { getScoresSnapshot } from "@/lib/scores-snapshot";
import { getSupabaseAdmin } from "@/lib/supabase";
import { scoreEntryFrames } from "@/lib/txline-parse";
import { getReplayTimeline, parseOddsFrames } from "@/lib/replay";
import type { OddsFrame, ScoreFrame } from "@/lib/replay-core";

export const MAX_TAKES_PER_MATCH = 12;
const SWING_POINTS = 15; // probability points, not relative percent
const MAX_NEW_PER_POLL = 3; // spread generation across polls, bound latency
const ODDS_UPDATES_TTL_MS = 25_000; // swings don't need 7s granularity

export interface PunditEvent {
  key: string; // deterministic dedupe key within a fixture
  kind: "goal" | "red" | "swing" | "ask";
  minute: number; // match minute, 0 = pre-match
  order: number; // clock seconds, for stable ordering
  headline: string; // what happened (prompt input)
  context: string; // score + market shift (prompt input)
}

export interface PunditTake {
  eventKey: string;
  kind: string;
  minute: number;
  take: string;
  createdAt: string; // ISO
}

interface Teams {
  home: string;
  away: string;
}

const minuteOf = (t: number) => (t <= 0 ? 0 : Math.max(1, Math.ceil(t / 60)));

/**
 * Derive take-worthy events from clock-keyed frames. Pure and deterministic:
 * the same frames always produce the same event keys, which is what lets a
 * replay hit the cache the live watch filled.
 */
export function derivePunditEvents(
  scoreFrames: ScoreFrame[],
  oddsFrames: OddsFrame[],
  teams: Teams,
): PunditEvent[] {
  const events: PunditEvent[] = [];
  const seen = new Set<string>();
  const push = (e: PunditEvent) => {
    if (!seen.has(e.key)) {
      seen.add(e.key);
      events.push(e);
    }
  };

  const probLine = (p: OddsFrame["prob"]) =>
    `${teams.home} ${Math.round(p.home)}%, draw ${Math.round(p.draw)}%, ${teams.away} ${Math.round(p.away)}%`;
  const probAround = (t: number) => {
    let before: OddsFrame | null = null;
    let after: OddsFrame | null = null;
    for (const f of oddsFrames) {
      if (f.t < t) before = f;
      else if (!after) after = f;
    }
    return { before, after };
  };
  const scoreText = (s: { home: number; away: number }) =>
    `${teams.home} ${s.home}-${s.away} ${teams.away}`;

  // Goals and red cards from the score frames.
  let prevScore = { home: 0, away: 0 };
  let prevRed = { home: 0, away: 0 };
  for (const f of scoreFrames) {
    if (f.score.home + f.score.away > prevScore.home + prevScore.away) {
      const scorer =
        f.score.home > prevScore.home && f.score.away > prevScore.away
          ? "both sides"
          : f.score.home > prevScore.home
            ? teams.home
            : teams.away;
      const { before, after } = probAround(f.t);
      const shift =
        before && after
          ? ` Win probabilities moved from (${probLine(before.prob)}) to (${probLine(after.prob)}).`
          : "";
      push({
        key: `goal:${f.score.home}-${f.score.away}`,
        kind: "goal",
        minute: minuteOf(f.t),
        order: f.t,
        headline: `GOAL for ${scorer}.`,
        context: `It is now ${scoreText(f.score)}.${shift}`,
      });
    }
    prevScore = f.score;

    const red = f.red ?? prevRed;
    for (const side of ["home", "away"] as const) {
      if (red[side] > prevRed[side]) {
        const team = side === "home" ? teams.home : teams.away;
        push({
          key: `red:${side}:${red[side]}`,
          kind: "red",
          minute: minuteOf(f.t),
          order: f.t,
          headline: `RED CARD for ${team} (their ${red[side] > 1 ? `${red[side]}th` : "first"} of the match). They are a man down.`,
          context: `Score is ${scoreText(f.score)}.`,
        });
      }
    }
    prevRed = red;
  }

  // Market swings: anchor walk over the 1X2 probability history. The anchor
  // only moves when a swing is emitted, so slow drifts still register once
  // they add up to more than SWING_POINTS.
  if (oddsFrames.length > 1) {
    let anchor = oddsFrames[0];
    let lastScore = { home: 0, away: 0 };
    for (const f of oddsFrames.slice(1)) {
      const dHome = f.prob.home - anchor.prob.home;
      const dAway = f.prob.away - anchor.prob.away;
      if (Math.abs(dHome) > SWING_POINTS || Math.abs(dAway) > SWING_POINTS) {
        const side = Math.abs(dHome) >= Math.abs(dAway) ? "home" : "away";
        const team = side === "home" ? teams.home : teams.away;
        const from = Math.round(side === "home" ? anchor.prob.home : anchor.prob.away);
        const to = Math.round(side === "home" ? f.prob.home : f.prob.away);
        for (const sf of scoreFrames) {
          if (sf.t <= f.t) lastScore = sf.score;
          else break;
        }
        push({
          key: `swing:${side}:${from}-${to}`,
          kind: "swing",
          minute: minuteOf(f.t),
          order: f.t,
          headline: `Big market move: ${team}'s win probability swung from ${from}% to ${to}%.`,
          context: `Score is ${scoreText(lastScore)}. Market now: ${probLine(f.prob)}.`,
        });
        anchor = f;
      }
    }
  }

  events.sort((a, b) => a.order - b.order);
  return events;
}

// --- Take cache (memory + Supabase) ------------------------------------------------

const memory = new Map<number, Map<string, PunditTake>>();

async function loadTakes(fixtureId: number): Promise<Map<string, PunditTake>> {
  let m = memory.get(fixtureId);
  if (!m) {
    m = new Map();
    memory.set(fixtureId, m);
  }
  const db = getSupabaseAdmin();
  if (db) {
    const { data } = await db
      .from("pundit_takes")
      .select("event_key, kind, minute, take, created_at")
      .eq("fixture_id", fixtureId);
    for (const r of data ?? []) {
      if (!m.has(r.event_key)) {
        m.set(r.event_key, {
          eventKey: r.event_key,
          kind: r.kind,
          minute: r.minute,
          take: r.take,
          createdAt: r.created_at,
        });
      }
    }
  }
  return m;
}

async function saveTake(
  fixtureId: number,
  ev: PunditEvent,
  take: string,
  m: Map<string, PunditTake>,
): Promise<void> {
  m.set(ev.key, {
    eventKey: ev.key,
    kind: ev.kind,
    minute: ev.minute,
    take,
    createdAt: new Date().toISOString(),
  });
  const db = getSupabaseAdmin();
  if (db) {
    const { error } = await db.from("pundit_takes").insert({
      fixture_id: fixtureId,
      event_key: ev.key,
      kind: ev.kind,
      minute: ev.minute,
      take,
    });
    // 23505 = another instance got there first: their take is as good as ours.
    if (error && error.code !== "23505") {
      console.error("[pundit] could not persist take:", error.message);
    }
  }
}

// --- Gemini -------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.0-flash";
const SYSTEM_PROMPT =
  "You are a sharp TV football pundit on a live betting show. Given a match event, " +
  "react in exactly one sentence of at most 25 words that tells viewers what the " +
  "betting market now believes. Be punchy and vivid. No hashtags, no emoji, " +
  "no quotation marks, no preamble.";

function geminiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

function tidyTake(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim().replace(/^["'“‘]+|["'”’]+$/g, "");
  const words = s.split(" ");
  if (words.length > 28) s = words.slice(0, 25).join(" ") + "...";
  return s;
}

async function generateTake(ev: PunditEvent, matchLabel: string): Promise<string | null> {
  const key = geminiKey();
  if (!key) return null;
  const base = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const when = ev.minute > 0 ? `Minute ${ev.minute}` : "Before kickoff";
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `${matchLabel}. ${when}. ${ev.headline} ${ev.context}` }],
      },
    ],
    generationConfig: { temperature: 0.9, maxOutputTokens: 80 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Gemini responded ${res.status}`);
      }
      if (!res.ok) {
        // 4xx other than 429 will not get better on retry (bad key, bad request).
        console.error("[pundit] Gemini rejected the request:", res.status, await res.text());
        return null;
      }
      const data = (await res.json()) as any;
      const text = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim();
      return text ? tidyTake(text) : null;
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1_200)); // free tier: one polite retry
      } else {
        console.error("[pundit] Gemini call failed:", err);
      }
    }
  }
  return null;
}

// --- Frame sources -------------------------------------------------------------------

// /odds/updates gives the full 1X2 price history (the snapshot only carries
// the latest price per market, which is useless for swing detection).
const oddsUpdatesCache = new Map<number, { at: number; raw: unknown }>();

async function getOddsUpdates(fixtureId: number): Promise<unknown> {
  const hit = oddsUpdatesCache.get(fixtureId);
  if (hit && Date.now() - hit.at < ODDS_UPDATES_TTL_MS) return hit.raw;
  const raw = await txlineGet(`/odds/updates/${fixtureId}`);
  oddsUpdatesCache.set(fixtureId, { at: Date.now(), raw });
  return raw;
}

interface Frames {
  scoreFrames: ScoreFrame[];
  oddsFrames: OddsFrame[];
}

async function liveFrames(fixtureId: number): Promise<Frames> {
  const [scoresRaw, oddsRaw] = await Promise.allSettled([
    getScoresSnapshot(fixtureId), // shared cache with getLiveState
    getOddsUpdates(fixtureId),
  ]);
  if (scoresRaw.status === "rejected") throw scoresRaw.reason;
  const scoreFrames = scoreEntryFrames(scoresRaw.value);
  // No odds history is fine: goals and reds still generate takes.
  const oddsFrames = parseOddsFrames(
    oddsRaw.status === "fulfilled" ? oddsRaw.value : null,
    scoreFrames,
  );
  return { scoreFrames, oddsFrames };
}

async function replayFrames(fixtureId: number): Promise<Frames> {
  const t = await getReplayTimeline(fixtureId);
  return { scoreFrames: t.scoreFrames, oddsFrames: t.oddsFrames };
}

// --- Public entry ---------------------------------------------------------------------

// One generation pass per fixture at a time (per process); overlapping polls
// serve the cache instead of stacking Gemini calls.
const inflight = new Set<number>();

export interface PunditFeed {
  enabled: boolean;
  takes: PunditTake[]; // sorted by match minute, oldest first
}

/**
 * The Pundit feed for a fixture. Live mode derives events from the current
 * scores/odds snapshots; replay mode (replayVt set) derives them from the
 * historical timeline and only SHOWS takes up to the scrub position (they
 * are all generated once, then every replay is free).
 */
export async function getPunditFeed(opts: {
  fixtureId: number;
  teams: Teams;
  replayVt?: number | null;
}): Promise<PunditFeed> {
  const { fixtureId, teams } = opts;
  const isReplay = opts.replayVt !== undefined && opts.replayVt !== null;
  const enabled = Boolean(geminiKey());

  const takesMap = await loadTakes(fixtureId);

  if (enabled && !inflight.has(fixtureId) && takesMap.size < MAX_TAKES_PER_MATCH) {
    inflight.add(fixtureId);
    try {
      const frames = isReplay ? await replayFrames(fixtureId) : await liveFrames(fixtureId);
      const events = derivePunditEvents(frames.scoreFrames, frames.oddsFrames, teams);
      const missing = events.filter((e) => !takesMap.has(e.key));
      const room = MAX_TAKES_PER_MATCH - takesMap.size;
      const matchLabel = `${teams.home} vs ${teams.away}`;
      for (const ev of missing.slice(0, Math.min(room, MAX_NEW_PER_POLL))) {
        const take = await generateTake(ev, matchLabel);
        if (take) await saveTake(fixtureId, ev, take, takesMap);
      }
    } catch (err) {
      // Feed hiccup: serve whatever is cached, next poll tries again.
      console.error("[pundit] event derivation failed:", err);
    } finally {
      inflight.delete(fixtureId);
    }
  }

  let takes = [...takesMap.values()];
  if (isReplay) {
    const maxMinute = minuteOf(opts.replayVt ?? 0);
    takes = takes.filter((t) => t.minute <= maxMinute);
  }
  takes.sort((a, b) => a.minute - b.minute || a.createdAt.localeCompare(b.createdAt));
  return { enabled, takes };
}

/**
 * On-demand take: the viewer asks the pundit for its read of the CURRENT
 * moment (live now, or the replay's scrub position). Cached per (fixture,
 * minute) so tapping again at the same point is free, and persisted so it
 * also shows up in the ticker at that minute. Disabled (take: null) when no
 * Gemini key is configured.
 */
export async function askPunditNow(opts: {
  fixtureId: number;
  teams: Teams;
  minute: number;
  score: { home: number; away: number };
  prob?: { home: number; draw: number; away: number } | null;
}): Promise<{ enabled: boolean; take: PunditTake | null }> {
  const { fixtureId, teams, minute, score } = opts;
  const enabled = Boolean(geminiKey());
  if (!enabled) return { enabled: false, take: null };

  const takesMap = await loadTakes(fixtureId);
  const key = `ask:${minute}`;
  const cached = takesMap.get(key);
  if (cached) return { enabled, take: cached };

  const probText = opts.prob
    ? ` Market: ${teams.home} ${Math.round(opts.prob.home)}%, draw ${Math.round(opts.prob.draw)}%, ${teams.away} ${Math.round(opts.prob.away)}%.`
    : "";
  const ev: PunditEvent = {
    key,
    kind: "ask",
    minute,
    order: minute * 60,
    headline: "A viewer asks for your read on the game right now.",
    context: `Score is ${teams.home} ${score.home}-${score.away} ${teams.away}.${probText}`,
  };
  const take = await generateTake(ev, `${teams.home} vs ${teams.away}`);
  if (!take) return { enabled, take: null };
  await saveTake(fixtureId, ev, take, takesMap);
  return { enabled, take: takesMap.get(key) ?? null };
}
