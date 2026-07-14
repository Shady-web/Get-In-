"use client";

// Recent form card: each team's last 5 results, so you can check form
// before you predict. Collapsible; always visible so a matchup never loses
// its form panel, even while loading or when the feed is unavailable.

import { useEffect, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight } from "lucide-react";
import { Flag } from "@/components/flag";

interface FormResult {
  opponent: string;
  home: boolean;
  score: string;
  result: "W" | "D" | "L";
  startTime: number;
}
interface TeamForm {
  name: string;
  form: FormResult[];
  summary: string;
}
interface MatchStats {
  fixtureId: number;
  home: TeamForm;
  away: TeamForm;
}

const resultColor = (r: "W" | "D" | "L") =>
  r === "W" ? "var(--color-tape-green)" : r === "L" ? "var(--color-festival-red)" : "var(--color-fog)";

function TeamRow({ team }: { team: TeamForm }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Flag country={team.name} />
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0 }} className="team">
          {team.name}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {team.summary}
        </span>
      </div>
      {team.form.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {team.form.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="form-pill"
                style={{ background: resultColor(r.result), color: "var(--color-void)" }}
              >
                {r.result}
              </span>
              <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", minWidth: 34 }}>
                {r.score}
              </span>
              <span className="muted" style={{ fontSize: 12, flex: 1, minWidth: 0 }} >
                {r.home ? "vs" : "at"}{" "}
                <span className="team">{r.opponent}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>
          No recent matches yet.
        </p>
      )}
    </div>
  );
}

export function MatchStats({
  fixtureId,
  home,
  away,
}: {
  fixtureId: number;
  home?: string;
  away?: string;
}) {
  const [stats, setStats] = useState<MatchStats | null>(null);
  const [open, setOpen] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setFailed(false);
    const qs = new URLSearchParams();
    if (home) qs.set("home", home);
    if (away) qs.set("away", away);
    const q = qs.toString();
    fetch(`/api/stats/${fixtureId}${q ? `?${q}` : ""}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body?.error ?? "stats unavailable");
        if (!cancelled) setStats(body.stats as MatchStats);
      })
      .catch(() => {
        if (!cancelled) setFailed(true); // keep the card, show a clear state
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureId, home, away]);

  const noHistory =
    stats !== null && stats.home.form.length === 0 && stats.away.form.length === 0;

  return (
    <div className="card fade-in" style={{ display: "grid", gap: open ? 14 : 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          color: "inherit",
          font: "inherit",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 0,
        }}
      >
        <span className="caption section-label">
          <BarChart3 size={13} aria-hidden style={{ verticalAlign: -2, marginRight: 5 }} /> Recent form · last 5
        </span>
        <span className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}>
          {open ? "Hide" : "Show"}
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </span>
      </button>

      {open &&
        (stats ? (
          noHistory ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No recent results for these teams in the schedule yet. Form
              appears once they have finished matches on record.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <TeamRow team={stats.home} />
              <div style={{ height: 1, background: "var(--color-border)" }} />
              <TeamRow team={stats.away} />
            </div>
          )
        ) : failed ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Recent form is unavailable right now. Check back in a moment.
          </p>
        ) : (
          <div className="skeleton" style={{ height: 96 }} />
        ))}
    </div>
  );
}
