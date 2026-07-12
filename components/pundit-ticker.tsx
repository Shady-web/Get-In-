"use client";

// Pundit ticker: a scrolling feed of one-line AI hot takes that only appear
// when something take-worthy happens (goal, red card, or a >15-point market
// swing). The browser polls our own /api/pundit route; the Gemini key never
// leaves the server. Hidden entirely while there is nothing to say.

import { useCallback, useEffect, useState } from "react";
import { Mic, Goal, Square, TrendingUp, MessageSquare } from "lucide-react";

interface Take {
  eventKey: string;
  kind: string;
  minute: number;
  take: string;
  createdAt: string;
}

function KindIcon({ kind }: { kind: string }) {
  const props = { size: 13, "aria-hidden": true, style: { verticalAlign: -2, marginRight: 4 } } as const;
  if (kind === "goal") return <Goal {...props} />;
  if (kind === "red") return <Square {...props} fill="var(--color-festival-red)" color="var(--color-festival-red)" />;
  if (kind === "swing") return <TrendingUp {...props} />;
  return <Mic {...props} />;
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function PunditTicker({
  fixtureId,
  home,
  away,
  getVt,
  askable = false,
}: {
  fixtureId: number;
  home: string;
  away: string;
  /** Replay scrub position in clock seconds; omit for live matches. */
  getVt?: () => number;
  /** Show an "Ask the pundit" button for an on-demand take on this moment. */
  askable?: boolean;
}) {
  const [takes, setTakes] = useState<Take[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<Take | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const q = new URLSearchParams({ home, away });
      if (getVt) q.set("vt", String(Math.floor(getVt())));
      const res = await fetch(`/api/pundit/${fixtureId}?${q.toString()}`);
      const body = await res.json();
      if (!res.ok || !body.ok) return; // the ticker is a garnish: fail quietly
      setEnabled(Boolean(body.enabled));
      setTakes(body.takes as Take[]);
    } catch {
      /* next poll */
    }
  }, [fixtureId, home, away, getVt]);

  useEffect(() => {
    void poll();
    // Replays move faster than real time, so peek at the scrubber more often.
    const id = window.setInterval(() => void poll(), getVt ? 4_000 : 10_000);
    return () => window.clearInterval(id);
  }, [poll, getVt]);

  async function ask() {
    setAsking(true);
    setAskNote(null);
    try {
      const res = await fetch(`/api/pundit/${fixtureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home, away, vt: getVt ? Math.floor(getVt()) : undefined }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "The pundit is unavailable.");
      if (body.take) {
        setAsked(body.take as Take);
        void poll(); // fold it into the timeline feed too
      } else {
        setAskNote("The pundit is offline right now.");
      }
    } catch (err) {
      setAskNote(err instanceof Error ? err.message : "The pundit is unavailable.");
    } finally {
      setAsking(false);
    }
  }

  // Show whenever there is something to say, or when an on-demand ask is
  // possible (the pundit is enabled server-side).
  if (!enabled || (takes.length === 0 && !askable)) return null;

  const newestFirst = [...takes].reverse();

  return (
    <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <p className="caption section-label">
          <Mic size={13} aria-hidden style={{ verticalAlign: -2, marginRight: 5 }} /> Pundit
        </p>
        <span className="muted" style={{ fontSize: 11 }}>
          AI takes on what the market thinks
        </span>
      </div>

      {askable && (
        <div style={{ display: "grid", gap: 8 }}>
          <button
            className="pill tab"
            onClick={() => void ask()}
            disabled={asking}
            style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <MessageSquare size={13} aria-hidden />
            {asking ? "Asking the pundit..." : "Ask the pundit about this moment"}
          </button>
          {asked && (
            <div
              className="fade-in"
              style={{
                display: "grid",
                gap: 3,
                padding: "10px 12px",
                borderRadius: 10,
                background: "var(--surface-elevated-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <span style={{ fontSize: 13, lineHeight: 1.45 }}>
                <Mic size={13} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />
                {asked.take}
              </span>
              <span className="muted" style={{ fontSize: 10.5 }}>
                {asked.minute > 0 ? `${asked.minute}'` : "Pre-match"} · you asked
              </span>
            </div>
          )}
          {askNote && (
            <span className="muted" style={{ fontSize: 12 }}>
              {askNote}
            </span>
          )}
        </div>
      )}

      {newestFirst.length > 0 && (
        <div className="pundit-feed" role="log" aria-label="Pundit takes">
          {newestFirst.map((t) => (
            <div key={t.eventKey} className="pundit-item">
              <span className="pundit-minute">
                {t.minute > 0 ? `${t.minute}'` : "PRE"}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                <span style={{ fontSize: 13, lineHeight: 1.45 }}>
                  <KindIcon kind={t.kind} /> {t.take}
                </span>
                <span className="muted" style={{ fontSize: 10.5 }}>
                  {timeLabel(t.createdAt)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
