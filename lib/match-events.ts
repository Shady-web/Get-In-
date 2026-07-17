// Server-only: the discrete-incident timeline of a match (goals + bookings).
//
// Two sources, best to worst:
//   1. An incidents feed (/scores/incidents/{id}) that names the scorer /
//      booked player. Parsed defensively across a few likely key spellings,
//      since the incident shape is not in the published spec.
//   2. Derived from the score/card TOTALS in the replay frames: we always know
//      WHEN a goal or card happened and for WHICH side, just not the player.
//
// Whichever source we have, the result is the same MatchEvent[] the replay
// view reveals as the clock passes each incident.

import type { MatchEvent, ScoreFrame } from "@/lib/replay-core";

const minuteOf = (t: number) => (t <= 0 ? 0 : Math.max(1, Math.ceil(t / 60)));

interface Teams {
  home: string;
  away: string;
}

/** First defined property among the given keys (case-insensitive-ish). */
function pick(obj: any, ...keys: string[]): any {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
  }
  return undefined;
}

function kindOf(raw: unknown): MatchEvent["kind"] | null {
  const s = String(raw ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s.includes("goal") || s === "g" || s.includes("pen")) return "goal";
  if (s.includes("redcard") || s === "red" || s === "rc" || s.includes("secondyellow")) return "red";
  if (s.includes("yellowcard") || s === "yellow" || s === "yc" || s.includes("booking")) return "yellow";
  return null;
}

/**
 * Parse an incidents payload into named events. Home/away is resolved from the
 * participant id when the fixture's two ids are known, else from an explicit
 * side/home flag on the incident.
 */
export function parseIncidents(
  raw: unknown,
  ids?: { home: number; away: number },
): MatchEvent[] {
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.Incidents) ? (raw as any).Incidents : [];
  const events: MatchEvent[] = [];
  for (const entry of rows) {
    const u = (entry as any)?.data ?? entry;
    if (!u || typeof u !== "object") continue;
    const kind = kindOf(pick(u, "Type", "type", "Kind", "kind", "Incident", "incident"));
    if (!kind) continue;

    // Minute first (feeds usually give it directly); fall back to a seconds field.
    const minRaw = pick(u, "Minute", "minute", "Min", "min");
    const secRaw = pick(u, "Seconds", "seconds", "ClockSeconds", "t");
    const minute = minRaw != null ? Math.max(0, Math.floor(Number(minRaw))) : minuteOf(Number(secRaw ?? 0));
    const t = secRaw != null ? Number(secRaw) : minute * 60;

    // Side: explicit flag, or resolve the participant id against the fixture.
    let team: "home" | "away" | null = null;
    const homeFlag = pick(u, "IsHome", "isHome", "Home", "home");
    const side = String(pick(u, "Side", "side", "Team", "team") ?? "").toLowerCase();
    const pid = Number(pick(u, "ParticipantId", "participantId", "TeamId", "teamId"));
    if (typeof homeFlag === "boolean") team = homeFlag ? "home" : "away";
    else if (side === "home" || side === "1" || side === "part1") team = "home";
    else if (side === "away" || side === "2" || side === "part2") team = "away";
    else if (ids && Number.isFinite(pid)) team = pid === ids.home ? "home" : pid === ids.away ? "away" : null;
    if (!team) continue;

    const player =
      (pick(u, "PlayerName", "playerName", "Player", "player", "Scorer", "scorer", "Name", "name") as string) ??
      null;

    events.push({ t, minute, team, kind, player: player ? String(player) : null });
  }
  events.sort((a, b) => a.t - b.t || a.minute - b.minute);
  return events;
}

/**
 * Derive events from score/card totals in the frames (no player names). Totals
 * are treated as monotonic high-water marks: an event is emitted only when a
 * team's running maximum for that kind increases. This is deliberate — the
 * real feed can momentarily drop or omit a total (amendments, missing fields),
 * and without the high-water mark a dip-then-recover would re-emit the same
 * goal or card.
 */
export function deriveEventsFromFrames(frames: ScoreFrame[]): MatchEvent[] {
  const events: MatchEvent[] = [];
  const hi = {
    goal: { home: 0, away: 0 },
    yellow: { home: 0, away: 0 },
    red: { home: 0, away: 0 },
  };

  const emit = (
    kind: MatchEvent["kind"],
    cur: { home: number; away: number } | undefined,
    t: number,
  ) => {
    if (!cur) return;
    for (const team of ["home", "away"] as const) {
      while (hi[kind][team] < cur[team]) {
        hi[kind][team] += 1;
        events.push({ t, minute: minuteOf(t), team, kind, player: null });
      }
    }
  };

  for (const f of frames) {
    emit("goal", f.score, f.t);
    emit("yellow", f.yellow, f.t);
    emit("red", f.red, f.t);
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

/** Final (latest) goal tally from the frames: home = Participant1, away = P2. */
function finalGoals(frames: ScoreFrame[]): { home: number; away: number } {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i]?.score) return frames[i].score;
  }
  return { home: 0, away: 0 };
}

/**
 * Keep the incidents feed on the SAME side convention as everything else in
 * the app (home = Participant1, away = Participant2, per the scores frames).
 *
 * The incidents feed attributes events by the *venue* home/away team, which is
 * NOT always Participant1 — when Participant1IsHome is false the two are
 * opposite, and the feed would show every goal under the wrong flag (the score
 * looked "inverse"). The frame goal totals are authoritative and already in
 * our convention, so if the named goals only line up when swapped, the whole
 * incident list is flipped to match. Symmetric or unclear tallies are left
 * as-is (flipping wouldn't change the visible scoreline anyway).
 */
function reconcileSides(events: MatchEvent[], frames: ScoreFrame[]): MatchEvent[] {
  const fg = finalGoals(frames);
  let namedHome = 0;
  let namedAway = 0;
  for (const e of events) {
    if (e.kind !== "goal") continue;
    if (e.team === "home") namedHome += 1;
    else namedAway += 1;
  }
  const aligned = namedHome === fg.home && namedAway === fg.away;
  const swapped = namedHome === fg.away && namedAway === fg.home;
  if (swapped && !aligned) {
    return events.map((e) => ({ ...e, team: e.team === "home" ? "away" : "home" }));
  }
  return events;
}

/**
 * The richest event timeline available: named incidents when the feed carries
 * them, otherwise the frame-derived goals + cards. When incidents exist but
 * omit some (e.g. only goals), we still trust them as the source of truth -
 * after reconciling their side attribution against the frame totals so the
 * feed never shows the scorers on the wrong team.
 */
export function buildMatchEvents(
  frames: ScoreFrame[],
  incidentsRaw: unknown,
  ids?: { home: number; away: number },
): MatchEvent[] {
  const named = parseIncidents(incidentsRaw, ids);
  if (named.length > 0) return reconcileSides(named, frames);
  return deriveEventsFromFrames(frames);
}

/** Label helper: "GOAL", "Yellow card", "Red card". */
export function eventLabel(kind: MatchEvent["kind"]): string {
  return kind === "goal" ? "Goal" : kind === "yellow" ? "Yellow card" : "Red card";
}

export const _test = { minuteOf, kindOf, reconcileSides, finalGoals };
