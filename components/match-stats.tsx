"use client";

// Recent form card: each team's last 5 results, so you can check form
// before you predict. Collapsible; always visible so a matchup never loses
// its form panel, even while loading or when the feed is unavailable.

import { useEffect, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, House } from "lucide-react";
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

/** A short 3-letter code for an opponent, e.g. "Portugal" -> "POR". */
const teamCode = (name: string) =>
  (name.replace(/[^A-Za-z]/g, "").slice(0, 3) || "???").toUpperCase();

/** The scoreline in home:away order (the team's venue tells you which side). */
function fixtureScore(r: FormResult): string {
  const [mine, opp] = r.score.split("-");
  return r.home ? `${mine}:${opp}` : `${opp}:${mine}`;
}

function Pill({ result }: { result: "W" | "D" | "L" }) {
  return (
    <span
      className="form-pill"
      style={{ background: resultColor(result), color: "var(--color-void)", flex: "none" }}
    >
      {result}
    </span>
  );
}

/** Venue glyph: a house when the team played at home, "@" when away. */
function Venue({ home }: { home: boolean }) {
  return home ? (
    <House size={12} aria-label="home" style={{ color: "var(--color-fog)", flex: "none" }} />
  ) : (
    <span className="muted" style={{ fontSize: 12, flex: "none" }} aria-label="away">
      @
    </span>
  );
}

const teamNameStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 12.5,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const codeStyle: React.CSSProperties = { fontWeight: 700, fontSize: 11.5, flex: "none" };
const scoreStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontVariantNumeric: "tabular-nums",
  flex: "none",
};

/** One team's five results as an outward-reading column (pills on the edge). */
function FormSide({ team, side }: { team: TeamForm; side: "left" | "right" }) {
  if (team.form.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 11.5, textAlign: side }}>
        No recent matches.
      </p>
    );
  }
  return (
    <div className={`form5-side ${side}`}>
      {team.form.map((r, i) =>
        side === "left" ? (
          <div key={i} className="form5-row" title={r.opponent}>
            <Pill result={r.result} />
            <Venue home={r.home} />
            <span className="mono" style={codeStyle}>
              {teamCode(r.opponent)}
            </span>
            <span className="mono" style={{ ...scoreStyle, marginLeft: "auto" }}>
              {fixtureScore(r)}
            </span>
          </div>
        ) : (
          <div key={i} className="form5-row" title={r.opponent}>
            <span className="mono" style={scoreStyle}>
              {fixtureScore(r)}
            </span>
            <span className="mono" style={{ ...codeStyle, marginLeft: "auto" }}>
              {teamCode(r.opponent)}
            </span>
            <Venue home={r.home} />
            <Pill result={r.result} />
          </div>
        ),
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
            <div style={{ display: "grid", gap: 10 }}>
              {/* Team names + form summary, home left / away right */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                  <Flag country={stats.home.name} size={16} />
                  <span className="team" style={teamNameStyle}>
                    {stats.home.name}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flex: 1,
                    minWidth: 0,
                    justifyContent: "flex-end",
                  }}
                >
                  <span className="team" style={{ ...teamNameStyle, textAlign: "right" }}>
                    {stats.away.name}
                  </span>
                  <Flag country={stats.away.name} size={16} />
                </div>
              </div>

              <div className="form5-bar">Last 5 matches</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                <FormSide team={stats.home} side="left" />
                <FormSide team={stats.away} side="right" />
              </div>
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
