"use client";

// Replay match-events timeline: goals and bookings, revealed as the replay
// clock passes each incident. Compact and collapsible, split into two columns
// so each team's events sit under its own side. Shows the scorer / booked
// player when the feed names them, otherwise a short "Goal"/"Yellow"/"Red".

import { useState } from "react";
import { Goal, Square, ChevronDown, ChevronRight } from "lucide-react";
import { Flag } from "@/components/flag";
import type { MatchEvent } from "@/lib/replay-core";

function EventDot({ kind }: { kind: MatchEvent["kind"] }) {
  if (kind === "goal") return <Goal size={13} aria-hidden />;
  const color = kind === "red" ? "var(--color-festival-red)" : "#ffcf3f";
  return <Square size={11} aria-hidden fill={color} color={color} style={{ borderRadius: 2 }} />;
}

const kindLabel: Record<MatchEvent["kind"], string> = {
  goal: "Goal",
  yellow: "Yellow",
  red: "Red",
};

/** One compact event line: minute + icon + player/label, mirrored per side. */
function EventLine({ e, align }: { e: MatchEvent; align: "left" | "right" }) {
  const minute = (
    <span className="mono" style={{ flex: "none", fontSize: 11, color: "var(--color-ash)" }}>
      {e.minute > 0 ? `${e.minute}'` : "0'"}
    </span>
  );
  const icon = (
    <span
      aria-hidden
      style={{
        flex: "none",
        display: "inline-flex",
        color: e.kind === "goal" ? "var(--color-snow)" : undefined,
      }}
    >
      <EventDot kind={e.kind} />
    </span>
  );
  const text = (
    <span
      style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      {e.player ?? kindLabel[e.kind]}
    </span>
  );
  return (
    <div
      className="fade-in"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexDirection: align === "right" ? "row-reverse" : "row",
        textAlign: align,
      }}
    >
      {minute}
      {icon}
      {text}
    </div>
  );
}

function TeamColumn({
  team,
  events,
  align,
}: {
  team: string;
  events: MatchEvent[];
  align: "left" | "right";
}) {
  return (
    <div style={{ display: "grid", gap: 7, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexDirection: align === "right" ? "row-reverse" : "row",
        }}
      >
        <Flag country={team} size={16} />
        <span
          className="team"
          style={{ fontSize: 12, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {team}
        </span>
      </div>
      {events.length === 0 ? (
        <span className="muted" style={{ fontSize: 11.5, textAlign: align }}>
          —
        </span>
      ) : (
        events.map((e, i) => <EventLine key={`${e.kind}-${e.t}-${i}`} e={e} align={align} />)
      )}
    </div>
  );
}

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
  const [open, setOpen] = useState(true);
  if (events.length === 0) return null;

  const shown = events.filter((e) => e.t <= vt);
  const homeEvents = shown.filter((e) => e.team === "home");
  const awayEvents = shown.filter((e) => e.team === "away");

  return (
    <div className="card fade-in" style={{ display: "grid", gap: open ? 12 : 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          color: "inherit",
          font: "inherit",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span className="caption section-label">Match events</span>
        <span
          className="muted"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}
        >
          {shown.length}/{events.length}
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </span>
      </button>

      {open &&
        (shown.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No goals or cards yet. They appear here as the replay reaches them.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <TeamColumn team={home} events={homeEvents} align="left" />
            <TeamColumn team={away} events={awayEvents} align="right" />
          </div>
        ))}
    </div>
  );
}
