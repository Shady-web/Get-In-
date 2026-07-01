"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  clearStoredPlayer,
  displayName,
  getStoredPlayer,
  type StoredPlayer,
} from "@/lib/player";
import type { LiveState } from "@/lib/live";

interface Fixture {
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  Participant1: string;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
}

/** A match counts as "live" from kickoff until ~3h after (ET + pens headroom). */
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

function isLive(f: Fixture, now: number): boolean {
  return f.StartTime <= now && now - f.StartTime < LIVE_WINDOW_MS;
}

function kickoffLabel(startTime: number): string {
  const d = new Date(startTime);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

export default function MatchScreen() {
  const router = useRouter();
  const { disconnect } = useWallet();
  const [player, setPlayer] = useState<StoredPlayer | null>(null);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState<Fixture | null>(null);

  useEffect(() => {
    const stored = getStoredPlayer();
    if (!stored) {
      router.replace("/");
      return;
    }
    setPlayer(stored);
    setChecked(true);
  }, [router]);

  function signOut() {
    clearStoredPlayer();
    disconnect().catch(() => {});
    router.replace("/");
  }

  if (!checked || !player) return null;

  return (
    <main className="shell" style={{ gap: 28 }}>
      <header className="topbar">
        <div className="brand">
          GetIN<span className="bang">!!!</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="pill" title={player.identity}>
            {displayName(player)}
          </span>
          <button
            className="pill"
            onClick={signOut}
            style={{ cursor: "pointer", color: "var(--color-fog)" }}
          >
            Out
          </button>
        </div>
      </header>

      {selected ? (
        <LiveMatch fixture={selected} onBack={() => setSelected(null)} />
      ) : (
        <FixtureList player={player} onPick={setSelected} />
      )}
    </main>
  );
}

// --- Fixture list -------------------------------------------------------------

function FixtureList({
  player,
  onPick,
}: {
  player: StoredPlayer;
  onPick: (f: Fixture) => void;
}) {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/worldcup")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Could not load fixtures.");
        if (!cancelled) setFixtures(body.data ?? []);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load fixtures.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const now = Date.now();
  const live = (fixtures ?? []).filter((f) => isLive(f, now));
  const upcoming = (fixtures ?? [])
    .filter((f) => f.StartTime > now)
    .sort((a, b) => a.StartTime - b.StartTime);

  const points = player.player?.total_points ?? 0;
  const streak = player.player?.best_streak ?? 0;

  return (
    <>
      <section style={{ display: "flex", gap: 10 }}>
        <span className="pill">
          <span className="k">Points</span> {points}
        </span>
        <span className="pill">
          <span className="k">Best streak</span> {streak}
        </span>
      </section>

      <section style={{ display: "grid", gap: "var(--element-gap)" }}>
        <p className="caption section-label">Live now</p>

        {error && <p className="error-text">{error}</p>}

        {!fixtures && !error && (
          <>
            <div className="skeleton" style={{ height: 64 }} />
            <div className="skeleton" style={{ height: 64, opacity: 0.6 }} />
          </>
        )}

        {fixtures && live.length === 0 && (
          <div className="card" style={{ textAlign: "center", display: "grid", gap: 6 }}>
            <h2 className="heading-sm">Nothing in play right now</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              Live matches appear here the moment they kick off.
            </p>
          </div>
        )}

        {live.map((f) => (
          <button key={f.FixtureId} className="row fixture-row" onClick={() => onPick(f)}>
            <span className="live-dot" />
            <span style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {f.Participant1} — {f.Participant2}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {f.Competition}
              </span>
            </span>
            <span style={{ color: "var(--color-tape-green)", fontSize: 12, fontWeight: 500 }}>
              LIVE
            </span>
          </button>
        ))}
      </section>

      {upcoming.length > 0 && (
        <section style={{ display: "grid", gap: "var(--element-gap)" }}>
          <p className="caption muted">Coming up</p>
          {upcoming.slice(0, 6).map((f) => (
            <button key={f.FixtureId} className="row fixture-row" disabled>
              <span style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                  {f.Participant1} — {f.Participant2}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {f.Competition}
                </span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {kickoffLabel(f.StartTime)}
              </span>
            </button>
          ))}
        </section>
      )}
    </>
  );
}

// --- Live match view -----------------------------------------------------------

const POLL_MS = 7_000;

function LiveMatch({ fixture, onBack }: { fixture: Fixture; onBack: () => void }) {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockText, setClockText] = useState<string | null>(null);
  const stateRef = useRef<LiveState | null>(null);

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/live/${fixture.FixtureId}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Live feed unavailable.");
      stateRef.current = body.state as LiveState;
      setState(body.state as LiveState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live feed unavailable.");
    }
  }, [fixture.FixtureId]);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  // Tick the clock locally every second between polls (and immediately on
  // the first data so it never shows a placeholder once state exists).
  useEffect(() => {
    const tick = () => {
      const s = stateRef.current;
      if (!s || s.clockSeconds === null) {
        setClockText(null);
        return;
      }
      const elapsed = s.clockRunning ? (Date.now() - s.fetchedAt) / 1000 : 0;
      const total = Math.max(0, Math.floor(s.clockSeconds + elapsed));
      const mm = Math.floor(total / 60);
      const ss = String(total % 60).padStart(2, "0");
      setClockText(`${mm}:${ss}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  const score = state?.score;
  const prob = state?.prob;

  return (
    <section style={{ display: "grid", gap: "var(--element-gap)" }}>
      <button
        className="pill"
        onClick={onBack}
        style={{ cursor: "pointer", justifySelf: "start", color: "var(--color-fog)" }}
      >
        ← Matches
      </button>

      <div className="card" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p className="caption section-label">{fixture.Competition}</p>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="live-dot" />
            <span className="muted" style={{ fontSize: 12 }}>
              {state?.phase ?? "Connecting…"}
            </span>
          </span>
        </div>

        {/* Teams + animated score */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 12,
          }}
        >
          <p style={{ fontWeight: 600, fontSize: 16, textAlign: "left" }}>
            {fixture.Participant1}
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            {score ? (
              <>
                <span key={`h${score.home}`} className="score-num score-pop">
                  {score.home}
                </span>
                <span className="score-num" style={{ color: "var(--color-slate)" }}>
                  –
                </span>
                <span key={`a${score.away}`} className="score-num score-pop">
                  {score.away}
                </span>
              </>
            ) : (
              <span className="score-num" style={{ color: "var(--color-slate)" }}>
                0–0
              </span>
            )}
          </div>
          <p style={{ fontWeight: 600, fontSize: 16, textAlign: "right" }}>
            {fixture.Participant2}
          </p>
        </div>

        <p className="clock" style={{ textAlign: "center" }}>
          {clockText ?? "—:—"}
        </p>

        {/* Win probability — validated categorical palette, labeled directly */}
        <div style={{ display: "grid", gap: 10 }}>
          <p className="caption muted">Win probability</p>
          {prob ? (
            <>
              <div
                className="prob-bar"
                role="img"
                aria-label={`Win probability: ${fixture.Participant1} ${prob.home}%, draw ${prob.draw}%, ${fixture.Participant2} ${prob.away}%`}
              >
                <div
                  className="prob-seg home"
                  style={{ width: `${prob.home}%` }}
                  title={`${fixture.Participant1} ${prob.home}%`}
                />
                <div
                  className="prob-seg draw"
                  style={{ width: `${prob.draw}%` }}
                  title={`Draw ${prob.draw}%`}
                />
                <div
                  className="prob-seg away"
                  style={{ width: `${prob.away}%` }}
                  title={`${fixture.Participant2} ${prob.away}%`}
                />
              </div>
              <div className="prob-labels">
                <span className="prob-label">
                  <i className="dot" style={{ background: "var(--series-home)" }} />
                  <span className="pct">{prob.home}%</span>
                  <span className="team">{fixture.Participant1}</span>
                </span>
                <span className="prob-label">
                  <i className="dot" style={{ background: "var(--series-draw)" }} />
                  <span className="pct">{prob.draw}%</span>
                  <span className="team">Draw</span>
                </span>
                <span className="prob-label">
                  <i className="dot" style={{ background: "var(--series-away)" }} />
                  <span className="pct">{prob.away}%</span>
                  <span className="team">{fixture.Participant2}</span>
                </span>
              </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Odds warming up — the bar appears once the market opens.
            </p>
          )}
        </div>

        <p className="caption muted" style={{ textAlign: "center" }}>
          {state?.bookmaker ? `${state.bookmaker} · ` : ""}updates every 7s
        </p>
      </div>

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
