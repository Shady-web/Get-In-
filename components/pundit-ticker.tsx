"use client";

// Pundit ticker: a scrolling feed of one-line AI hot takes that only appear
// when something take-worthy happens (goal, red card, or a >15-point market
// swing). The browser polls our own /api/pundit route; the Gemini key never
// leaves the server. Hidden entirely while there is nothing to say.

import { useCallback, useEffect, useState } from "react";
import { Mic, Goal, Square, TrendingUp } from "lucide-react";

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
}: {
  fixtureId: number;
  home: string;
  away: string;
  /** Replay scrub position in clock seconds; omit for live matches. */
  getVt?: () => number;
}) {
  const [takes, setTakes] = useState<Take[]>([]);
  const [enabled, setEnabled] = useState(false);

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

  if (!enabled || takes.length === 0) return null;

  const newestFirst = [...takes].reverse();

  return (
    <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <p className="caption section-label">
          <Mic size={13} aria-hidden style={{ verticalAlign: -2, marginRight: 5 }} /> Pundit
        </p>
        <span className="muted" style={{ fontSize: 11 }}>
          AI takes on what the market thinks
        </span>
      </div>
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
    </div>
  );
}
