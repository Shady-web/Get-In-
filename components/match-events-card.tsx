"use client";

// Replay match-events timeline: goals and bookings, revealed as the replay
// clock passes each incident. Shows the scorer / booked player when the feed
// carries names, otherwise just the team and minute.

import { Goal, Square } from "lucide-react";
import type { MatchEvent } from "@/lib/replay-core";

function EventIcon({ kind }: { kind: MatchEvent["kind"] }) {
  if (kind === "goal") return <Goal size={15} aria-hidden />;
  const color = kind === "red" ? "var(--color-festival-red)" : "#ffcf3f";
  return <Square size={13} aria-hidden fill={color} color={color} style={{ borderRadius: 2 }} />;
}

const kindLabel: Record<MatchEvent["kind"], string> = {
  goal: "Goal",
  yellow: "Yellow card",
  red: "Red card",
};

export function MatchEventsCard({
  events,
  vt,
  home,
  away,
}: {
  events: MatchEvent[];
  vt: number;
  home: string;
  away: string;
}) {
  if (events.length === 0) return null;
  const shown = events.filter((e) => e.t <= vt);

  return (
    <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p className="caption section-label">Match events</p>
        <span className="muted" style={{ fontSize: 11 }}>
          {shown.length}/{events.length} so far
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          No goals or cards yet — they appear here as the replay reaches them.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {shown.map((e, i) => {
            const team = e.team === "home" ? home : away;
            return (
              <div
                key={`${e.kind}-${e.team}-${e.t}-${i}`}
                className="fade-in"
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <span
                  className="mono"
                  style={{ flex: "none", width: 34, fontSize: 12, color: "var(--color-ash)", textAlign: "right" }}
                >
                  {e.minute > 0 ? `${e.minute}'` : "0'"}
                </span>
                <span
                  aria-hidden
                  style={{
                    flex: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: e.kind === "goal" ? "var(--color-snow)" : undefined,
                  }}
                >
                  <EventIcon kind={e.kind} />
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }} className="team">
                    {e.player ?? kindLabel[e.kind]}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {e.player ? `${kindLabel[e.kind]} · ${team}` : team}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
