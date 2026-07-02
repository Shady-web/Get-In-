"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  clearStoredPlayer,
  displayName,
  getStoredPlayer,
  setStoredPlayer,
  type PlayerRecord,
  type StoredPlayer,
} from "@/lib/player";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import type { LiveState } from "@/lib/live";
import type { GameCard, GameOption, SettledResult } from "@/lib/game";

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
const POLL_MS = 7_000;

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
  const [tab, setTab] = useState<"matches" | "leaders">("matches");

  useEffect(() => {
    const stored = getStoredPlayer();
    if (!stored) {
      router.replace("/");
      return;
    }
    setPlayer(stored);
    setChecked(true);
  }, [router]);

  const updatePlayerRecord = useCallback((record: PlayerRecord) => {
    setPlayer((prev) => {
      if (!prev) return prev;
      const next = { ...prev, player: record };
      setStoredPlayer(next);
      return next;
    });
  }, []);

  function signOut() {
    clearStoredPlayer();
    disconnect().catch(() => {});
    router.replace("/");
  }

  if (!checked || !player) return null;

  return (
    <main className="shell" style={{ gap: 24 }}>
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

      {!selected && (
        <nav style={{ display: "flex", gap: 8 }}>
          <button
            className={`pill tab ${tab === "matches" ? "active" : ""}`}
            onClick={() => setTab("matches")}
          >
            Matches
          </button>
          <button
            className={`pill tab ${tab === "leaders" ? "active" : ""}`}
            onClick={() => setTab("leaders")}
          >
            Leaders
          </button>
        </nav>
      )}

      {selected ? (
        <LiveMatch
          fixture={selected}
          player={player}
          onBack={() => setSelected(null)}
          onPlayerUpdate={updatePlayerRecord}
        />
      ) : tab === "matches" ? (
        <FixtureList player={player} onPick={setSelected} />
      ) : (
        <Leaders player={player} />
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
  const streak = player.player?.current_streak ?? 0;

  return (
    <>
      <section style={{ display: "flex", gap: 10 }}>
        <span className="pill">
          <span className="k">Points</span> {points}
        </span>
        <span className="pill">
          <span className="k">Streak</span> {streak}
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
              Live matches appear here the moment they kick off. Tap an
              upcoming match to see its odds.
            </p>
          </div>
        )}

        {live.map((f) => (
          <button key={f.FixtureId} className="row fixture-row" onClick={() => onPick(f)}>
            <span className="live-dot" />
            <span style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {f.Participant1} vs {f.Participant2}
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
            <button key={f.FixtureId} className="row fixture-row" onClick={() => onPick(f)}>
              <span style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                  {f.Participant1} vs {f.Participant2}
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

function LiveMatch({
  fixture,
  player,
  onBack,
  onPlayerUpdate,
}: {
  fixture: Fixture;
  player: StoredPlayer;
  onBack: () => void;
  onPlayerUpdate: (p: PlayerRecord) => void;
}) {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockText, setClockText] = useState<string | null>(null);
  const stateRef = useRef<LiveState | null>(null);

  const matchStarted = fixture.StartTime <= Date.now();

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
  const odds = state?.odds;

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
            {matchStarted && <span className="live-dot" />}
            <span className="muted" style={{ fontSize: 12 }}>
              {matchStarted
                ? (state?.phase ?? "Connecting...")
                : `Kickoff ${kickoffLabel(fixture.StartTime)}`}
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
                  :
                </span>
                <span key={`a${score.away}`} className="score-num score-pop">
                  {score.away}
                </span>
              </>
            ) : (
              <span className="score-num" style={{ color: "var(--color-slate)" }}>
                0:0
              </span>
            )}
          </div>
          <p style={{ fontWeight: 600, fontSize: 16, textAlign: "right" }}>
            {fixture.Participant2}
          </p>
        </div>

        {matchStarted && (
          <p className="clock" style={{ textAlign: "center" }}>
            {clockText ?? "0:00"}
          </p>
        )}

        {/* Win probability + odds */}
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
              {odds && (
                <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>
                  Odds {odds.home.toFixed(2)} / {odds.draw.toFixed(2)} /{" "}
                  {odds.away.toFixed(2)}
                </p>
              )}
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Odds warming up. The bar appears once the market opens.
            </p>
          )}
        </div>

        <p className="caption muted" style={{ textAlign: "center" }}>
          {state?.bookmaker ? `${state.bookmaker} · ` : ""}updates every 7s
        </p>
      </div>

      {matchStarted && (
        <PredictionPanel
          fixture={fixture}
          player={player}
          onPlayerUpdate={onPlayerUpdate}
        />
      )}

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

// --- Prediction game panel ---------------------------------------------------------

function PredictionPanel({
  fixture,
  player,
  onPlayerUpdate,
}: {
  fixture: Fixture;
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
}) {
  const [card, setCard] = useState<GameCard | null>(null);
  const [pickedRound, setPickedRound] = useState<number | null>(null);
  const [pickedOption, setPickedOption] = useState<GameOption | null>(null);
  const [feed, setFeed] = useState<SettledResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pollCard = useCallback(async () => {
    if (document.hidden) return;
    try {
      const qs = new URLSearchParams({
        fixtureId: String(fixture.FixtureId),
        home: fixture.Participant1,
        away: fixture.Participant2,
        identity: player.identity,
      });
      const res = await fetch(`/api/game/card?${qs}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Game unavailable.");

      setCard(body.card ?? null);
      if (Array.isArray(body.settled) && body.settled.length > 0) {
        setFeed((prev) => [...body.settled, ...prev].slice(0, 4));
      }
      if (body.player) onPlayerUpdate(body.player as PlayerRecord);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Game unavailable.");
    }
  }, [fixture, player.identity, onPlayerUpdate]);

  useEffect(() => {
    void pollCard();
    const id = window.setInterval(() => void pollCard(), POLL_MS);
    return () => window.clearInterval(id);
  }, [pollCard]);

  async function pick(option: GameOption) {
    if (!card || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/game/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: player.identity,
          fixtureId: fixture.FixtureId,
          round: card.round,
          choice: option.id,
          home: fixture.Participant1,
          away: fixture.Participant2,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Pick failed.");
      setPickedRound(card.round);
      setPickedOption(body.pick as GameOption);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed.");
    } finally {
      setSaving(false);
    }
  }

  const locked = card !== null && pickedRound === card.round;

  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="caption section-label">Prediction</p>
        {card && (
          <span className="muted" style={{ fontSize: 12 }}>
            Round {card.round} · new card every minute
          </span>
        )}
      </div>

      {card ? (
        <>
          <h3 className="heading-sm">{card.question}</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {card.options.map((o) => {
              const chosen = locked && pickedOption?.id === o.id;
              return (
                <button
                  key={o.id}
                  className={`option-btn ${chosen ? "chosen" : ""}`}
                  disabled={locked || saving}
                  onClick={() => pick(o)}
                >
                  <span className="team">{o.label}</span>
                  <span className="points-badge">+{o.points} pts</span>
                </button>
              );
            })}
          </div>
          {locked && pickedOption && (
            <p style={{ fontSize: 13, color: "var(--color-tape-green)" }}>
              Locked in: {pickedOption.label} for +{pickedOption.points} pts.
              Settles automatically.
            </p>
          )}
        </>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          Cards open once the match clock is running.
        </p>
      )}

      {feed.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {feed.map((r, i) => (
            <p
              key={i}
              style={{
                fontSize: 13,
                color: r.result === "won" ? "var(--color-tape-green)" : "var(--color-ember-orange)",
              }}
            >
              {r.result === "won"
                ? `Called it! +${r.points} pts (${r.question})`
                : `Missed: ${r.question} Streak reset.`}
            </p>
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// --- Leaderboard + share card ---------------------------------------------------------

interface LeaderRow {
  wallet_or_nickname: string;
  total_points: number;
  best_streak: number;
  current_streak: number;
}

function Leaders({ player }: { player: StoredPlayer }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Leaderboard unavailable.");
      setRows(body.players);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Leaderboard unavailable.");
    }
  }, []);

  useEffect(() => {
    void load();
    // Realtime when Supabase browser env is present; polling otherwise.
    const supabase = getSupabaseBrowser();
    if (supabase) {
      const channel = supabase
        .channel("leaderboard")
        .on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => {
          void load();
        })
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    }
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const me = player.player;
  const shortName = (n: string) =>
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(n) ? `${n.slice(0, 4)}...${n.slice(-4)}` : n;

  return (
    <>
      {/* Share-my-streak card: screenshot this */}
      <section className="share-card" aria-label="Share my streak">
        <p className="caption section-label">GetIN!!! streak</p>
        <p className="share-streak">{me?.current_streak ?? 0}</p>
        <p className="muted" style={{ fontSize: 14 }}>
          correct calls in a row by{" "}
          <span style={{ color: "var(--color-snow)", fontWeight: 600 }}>
            {displayName(player)}
          </span>
        </p>
        <p className="caption muted">
          {me?.total_points ?? 0} pts total · best streak {me?.best_streak ?? 0} ·
          World Cup 2026
        </p>
      </section>
      <p className="caption muted" style={{ textAlign: "center", marginTop: -12 }}>
        Screenshot the card to share it
      </p>

      <section style={{ display: "grid", gap: "var(--element-gap)" }}>
        <p className="caption section-label">Leaderboard</p>

        {error && <p className="error-text">{error}</p>}
        {!rows && !error && <div className="skeleton" style={{ height: 160 }} />}

        {rows && rows.length === 0 && (
          <p className="muted" style={{ fontSize: 14 }}>
            No players yet. Be the first on the board.
          </p>
        )}

        {rows?.map((r, i) => {
          const mine = r.wallet_or_nickname === player.identity;
          return (
            <div
              key={r.wallet_or_nickname}
              className="row"
              style={mine ? { border: "1px solid var(--color-slate)" } : undefined}
            >
              <span className="muted" style={{ width: 22, fontVariantNumeric: "tabular-nums" }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, fontWeight: mine ? 600 : 400, minWidth: 0 }}>
                {shortName(r.wallet_or_nickname)}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                streak {r.current_streak}
              </span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {r.total_points}
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}
