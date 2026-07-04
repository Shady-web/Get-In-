"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MarketsPanel } from "@/components/markets-panel";
import { BetSlipProvider, BetSlipTray, useBetSlip } from "@/components/bet-slip";
import type { LiveState } from "@/lib/live";
import { buildCard, type GameCard, type GameOption, type SettledResult } from "@/lib/game-core";
import { stateAt, type ReplayTimeline } from "@/lib/replay-core";

interface Fixture {
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  Participant1: string;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
  // Real status from the server (drawn from the scores feed, not the clock):
  LiveStatus?: "live" | "upcoming" | "finished";
  Phase?: string | null;
  LiveScore?: { home: number; away: number } | null;
}

/** Replay window per TxLINE: started between 2 weeks and 6 hours ago. */
const REPLAY_MIN_AGE_MS = 6 * 60 * 60 * 1000;
const REPLAY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const POLL_MS = 7_000;

type Selection = { fixture: Fixture; mode: "live" | "replay" };

function isReplayable(f: Fixture, now: number): boolean {
  const age = now - f.StartTime;
  return age >= REPLAY_MIN_AGE_MS && age <= REPLAY_MAX_AGE_MS;
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

function fmtClock(seconds: number | null): string {
  if (seconds === null) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function MatchScreen() {
  const router = useRouter();
  const { disconnect } = useWallet();
  const [player, setPlayer] = useState<StoredPlayer | null>(null);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
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

  const coins = player.player?.coins;

  return (
    <BetSlipProvider>
    <main className="shell" style={{ gap: 24 }}>
      <header className="topbar">
        <div className="brand">
          GetIN<span className="bang">!!!</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {coins !== undefined && (
            <span className="pill" title="Coin bankroll">
              <span aria-hidden>🪙</span> {coins.toLocaleString()}
            </span>
          )}
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
        selected.mode === "live" ? (
          <LiveMatch
            fixture={selected.fixture}
            player={player}
            onBack={() => setSelected(null)}
            onPlayerUpdate={updatePlayerRecord}
          />
        ) : (
          <ReplayMatch
            fixture={selected.fixture}
            player={player}
            onBack={() => setSelected(null)}
            onPlayerUpdate={updatePlayerRecord}
          />
        )
      ) : tab === "matches" ? (
        <FixtureList player={player} onPick={setSelected} />
      ) : (
        <Leaders player={player} onPlayerUpdate={updatePlayerRecord} />
      )}

      <BetSlipTray player={player} onPlayerUpdate={updatePlayerRecord} />
    </main>
    </BetSlipProvider>
  );
}

// --- Fixture list -------------------------------------------------------------

function FixtureRow({
  fixture,
  right,
  left,
  onClick,
}: {
  fixture: Fixture;
  right: React.ReactNode;
  left?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="row fixture-row fade-in" onClick={onClick}>
      {left}
      <span style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>
          {fixture.Participant1} vs {fixture.Participant2}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {fixture.Competition}
        </span>
      </span>
      {right}
    </button>
  );
}

function FixtureList({
  player,
  onPick,
}: {
  player: StoredPlayer;
  onPick: (s: Selection) => void;
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
  // Trust the server's LiveStatus (drawn from the real scores feed). A match
  // deep in extra time or penalties is LIVE no matter what the clock says.
  const live = (fixtures ?? []).filter((f) => f.LiveStatus === "live");
  const justFinished = (fixtures ?? []).filter(
    (f) => f.LiveStatus === "finished" && now - f.StartTime < REPLAY_MIN_AGE_MS,
  );
  const upcoming = (fixtures ?? [])
    .filter((f) => (f.LiveStatus ? f.LiveStatus === "upcoming" : f.StartTime > now))
    .sort((a, b) => a.StartTime - b.StartTime);
  const replayable = (fixtures ?? [])
    .filter((f) => isReplayable(f, now))
    .sort((a, b) => b.StartTime - a.StartTime);

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
          <div className="fixture-grid">
            <div className="skeleton" style={{ height: 64 }} />
            <div className="skeleton" style={{ height: 64, opacity: 0.6 }} />
          </div>
        )}

        {fixtures && live.length === 0 && justFinished.length === 0 && (
          <div className="card fade-in" style={{ textAlign: "center", display: "grid", gap: 6 }}>
            <h2 className="heading-sm">Nothing in play right now</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              Live matches appear here the moment they kick off. Meanwhile,
              check the odds on upcoming games or replay a finished one below.
            </p>
          </div>
        )}

        <div className="fixture-grid">
          {live.map((f) => (
            <FixtureRow
              key={f.FixtureId}
              fixture={f}
              onClick={() => onPick({ fixture: f, mode: "live" })}
              left={<span className="live-dot" />}
              right={
                <span style={{ display: "grid", gap: 2, justifyItems: "end" }}>
                  <span
                    style={{ color: "var(--color-tape-green)", fontSize: 12, fontWeight: 600 }}
                  >
                    {f.LiveScore ? `${f.LiveScore.home}:${f.LiveScore.away}` : "LIVE"}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {f.Phase ?? "LIVE"}
                  </span>
                </span>
              }
            />
          ))}
          {justFinished.map((f) => (
            <FixtureRow
              key={f.FixtureId}
              fixture={f}
              onClick={() => onPick({ fixture: f, mode: "live" })}
              right={
                <span style={{ display: "grid", gap: 2, justifyItems: "end" }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    {f.LiveScore ? `${f.LiveScore.home}:${f.LiveScore.away}` : "FT"}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {f.Phase ?? "Full time"}
                  </span>
                </span>
              }
            />
          ))}
        </div>
      </section>

      {upcoming.length > 0 && (
        <section style={{ display: "grid", gap: "var(--element-gap)" }}>
          <p className="caption muted">Coming up</p>
          <div className="fixture-grid">
            {upcoming.slice(0, 6).map((f) => (
              <FixtureRow
                key={f.FixtureId}
                fixture={f}
                onClick={() => onPick({ fixture: f, mode: "live" })}
                right={
                  <span className="muted" style={{ fontSize: 12 }}>
                    {kickoffLabel(f.StartTime)}
                  </span>
                }
              />
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "grid", gap: "var(--element-gap)" }}>
        <p className="caption section-label">Replay mode</p>
        {fixtures && replayable.length === 0 && (
          <p className="muted fade-in" style={{ fontSize: 14 }}>
            No finished matches in the replay window yet (matches become
            replayable 6 hours after kickoff and stay for 2 weeks).
          </p>
        )}
        <div className="fixture-grid">
          {replayable.slice(0, 8).map((f) => (
            <FixtureRow
              key={f.FixtureId}
              fixture={f}
              onClick={() => onPick({ fixture: f, mode: "replay" })}
              right={
                <span style={{ color: "var(--color-ember-orange)", fontSize: 12, fontWeight: 500 }}>
                  REPLAY
                </span>
              }
            />
          ))}
        </div>
      </section>
    </>
  );
}

// --- Shared scoreboard -----------------------------------------------------------

function ScoreCard({
  fixture,
  state,
  clockText,
  headerRight,
  footer,
}: {
  fixture: Fixture;
  state: LiveState | null;
  clockText: string | null;
  headerRight: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const score = state?.score;
  const prob = state?.prob;
  const odds = state?.odds;

  return (
    <div className="card fade-in" style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="caption section-label">{fixture.Competition}</p>
        {headerRight}
      </div>

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

      {clockText !== null && (
        <p className="clock" style={{ textAlign: "center" }}>
          {clockText}
        </p>
      )}

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

      {footer}
    </div>
  );
}

// --- Prediction game panel ---------------------------------------------------------

interface ReplayGameHooks {
  session: string;
  getVt: () => number;
  localCard: GameCard | null; // built client-side each tick
}

function PredictionPanel({
  fixture,
  player,
  onPlayerUpdate,
  replay,
}: {
  fixture: Fixture;
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
  replay?: ReplayGameHooks;
}) {
  const [serverCard, setServerCard] = useState<GameCard | null>(null);
  const [pickedRound, setPickedRound] = useState<number | null>(null);
  const [pickedOption, setPickedOption] = useState<GameOption | null>(null);
  const [feed, setFeed] = useState<SettledResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Replay renders its locally built card (perfectly synced to the scrubber);
  // live renders the server's card. Settlement always goes through the server.
  const card = replay ? replay.localCard : serverCard;

  const pollCard = useCallback(async () => {
    if (document.hidden) return;
    try {
      const qs = new URLSearchParams({
        fixtureId: String(fixture.FixtureId),
        home: fixture.Participant1,
        away: fixture.Participant2,
        identity: player.identity,
      });
      if (replay) {
        qs.set("session", replay.session);
        qs.set("vt", String(Math.floor(replay.getVt())));
      }
      const res = await fetch(`/api/game/card?${qs}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Game unavailable.");

      setServerCard(body.card ?? null);
      if (Array.isArray(body.settled) && body.settled.length > 0) {
        setFeed((prev) => [...body.settled, ...prev].slice(0, 4));
      }
      if (body.player) onPlayerUpdate(body.player as PlayerRecord);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Game unavailable.");
    }
  }, [fixture, player.identity, onPlayerUpdate, replay]);

  useEffect(() => {
    void pollCard();
    const id = window.setInterval(() => void pollCard(), replay ? 5_000 : POLL_MS);
    return () => window.clearInterval(id);
  }, [pollCard, replay]);

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
          ...(replay
            ? { session: replay.session, vt: Math.floor(replay.getVt()) }
            : {}),
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
    <div className="card fade-in" style={{ display: "grid", gap: 14, alignSelf: "start" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="caption section-label">Prediction</p>
        {card && (
          <span className="muted" style={{ fontSize: 12 }}>
            {card.round === -1
              ? "Pre-match · settles at full time"
              : `Round ${card.round} · new card every minute`}
          </span>
        )}
      </div>

      {card ? (
        <>
          <h3 className="heading-sm" key={card.round}>
            {card.question}
          </h3>
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
          Picks open as soon as the market prices this match (pre-match calls
          included). Check back shortly.
        </p>
      )}

      {feed.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {feed.map((r, i) => (
            <p
              key={i}
              className="fade-in"
              style={{
                fontSize: 13,
                color:
                  r.result === "won"
                    ? "var(--color-tape-green)"
                    : "var(--color-ember-orange)",
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
  const [view, setView] = useState<"game" | "markets">("game");
  const stateRef = useRef<LiveState | null>(null);

  // Started = the FEED says so, not the fixture clock (kickoffs shift, and
  // extra time / penalties run long past any window).
  const matchStarted = state
    ? state.statusId !== null && state.statusId !== "NS"
    : fixture.LiveStatus === "live" ||
      fixture.LiveStatus === "finished" ||
      (!fixture.LiveStatus && fixture.StartTime <= Date.now());

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

  // Tick the clock locally every second between polls.
  useEffect(() => {
    const tick = () => {
      const s = stateRef.current;
      if (!s || s.clockSeconds === null) {
        setClockText(null);
        return;
      }
      const elapsed = s.clockRunning ? (Date.now() - s.fetchedAt) / 1000 : 0;
      setClockText(fmtClock(s.clockSeconds + elapsed));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  return (
    <section style={{ display: "grid", gap: "var(--element-gap)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="pill"
          onClick={onBack}
          style={{ cursor: "pointer", color: "var(--color-fog)" }}
        >
          ← Matches
        </button>
        <span style={{ flex: 1 }} />
        <button
          className={`pill tab ${view === "game" ? "active" : ""}`}
          onClick={() => setView("game")}
        >
          Game
        </button>
        <button
          className={`pill tab ${view === "markets" ? "active" : ""}`}
          onClick={() => setView("markets")}
        >
          Markets
        </button>
      </div>

      <div className="match-grid">
        <ScoreCard
          fixture={fixture}
          state={state}
          clockText={matchStarted ? clockText ?? "0:00" : null}
          headerRight={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {matchStarted && <span className="live-dot" />}
              <span className="muted" style={{ fontSize: 12 }}>
                {matchStarted
                  ? (state?.phase ?? "Connecting...")
                  : `Kickoff ${kickoffLabel(fixture.StartTime)}`}
              </span>
            </span>
          }
          footer={
            <p className="caption muted" style={{ textAlign: "center" }}>
              {state?.bookmaker ? `${state.bookmaker} · ` : ""}updates every 7s
            </p>
          }
        />

        {view === "game" ? (
          <PredictionPanel
            fixture={fixture}
            player={player}
            onPlayerUpdate={onPlayerUpdate}
          />
        ) : (
          <MarketsPanel fixture={fixture} />
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

// --- Replay match view -----------------------------------------------------------

const SPEEDS = [1, 10, 60] as const;

function ReplayMatch({
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
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vt, setVt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(10);
  const vtRef = useRef(0);
  vtRef.current = vt;

  // One replay session per visit: repeat replays never collide in the DB.
  const session = useMemo(
    () => `r${fixture.FixtureId}-${Math.random().toString(36).slice(2, 10)}`,
    [fixture.FixtureId],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/replay/${fixture.FixtureId}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body?.error ?? "Replay unavailable.");
        if (!cancelled) {
          setTimeline(body.timeline as ReplayTimeline);
          setPlaying(true);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Replay unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [fixture.FixtureId]);

  // The virtual clock: advance vt by speed while playing.
  useEffect(() => {
    if (!playing || !timeline) return;
    const id = window.setInterval(() => {
      setVt((prev) => {
        const next = prev + 0.25 * speed;
        if (next >= timeline.duration) {
          setPlaying(false);
          return timeline.duration;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [playing, speed, timeline]);

  const state = useMemo(
    () => (timeline ? stateAt(timeline, vt) : null),
    [timeline, vt],
  );

  const localCard = useMemo(
    () =>
      state
        ? buildCard(state, {
            home: fixture.Participant1,
            away: fixture.Participant2,
          })
        : null,
    [state, fixture],
  );

  const getVt = useCallback(() => vtRef.current, []);
  const replayHooks = useMemo(
    () => ({ session, getVt, localCard }),
    [session, getVt, localCard],
  );

  const ended = timeline !== null && vt >= timeline.duration;
  const { toggle, isSelected } = useBetSlip();

  // Tap-to-bet on the replay's match-winner odds (settles at the replay's FT).
  const replayOddsChips =
    state?.odds && !ended
      ? (["part1", "draw", "part2"] as const).map((name) => {
          const odds =
            name === "part1"
              ? state.odds!.home
              : name === "part2"
                ? state.odds!.away
                : state.odds!.draw;
          const label =
            name === "part1"
              ? fixture.Participant1
              : name === "part2"
                ? fixture.Participant2
                : "Draw";
          const selId = `${session}|1X2_PARTICIPANT_RESULT|||${name}`;
          return { name, odds, label, selId };
        })
      : null;

  return (
    <section style={{ display: "grid", gap: "var(--element-gap)" }}>
      <button
        className="pill"
        onClick={onBack}
        style={{ cursor: "pointer", justifySelf: "start", color: "var(--color-fog)" }}
      >
        ← Matches
      </button>

      {!timeline && !error && (
        <div style={{ display: "grid", gap: "var(--element-gap)" }}>
          <div className="skeleton" style={{ height: 220 }} />
          <div className="skeleton" style={{ height: 120, opacity: 0.6 }} />
          <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>
            Loading match history...
          </p>
        </div>
      )}

      {error && (
        <div className="card fade-in" style={{ textAlign: "center", display: "grid", gap: 6 }}>
          <h2 className="heading-sm">Replay unavailable</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            {error}
          </p>
        </div>
      )}

      {timeline && (
        <div className="match-grid">
          <div style={{ display: "grid", gap: "var(--element-gap)" }}>
            <ScoreCard
              fixture={fixture}
              state={state}
              clockText={fmtClock(vt)}
              headerRight={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      color: "var(--color-ember-orange)",
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    REPLAY
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {state?.phase ?? ""}
                  </span>
                </span>
              }
            />

            {/* Tap-to-bet on the winner at the replay's current odds */}
            {replayOddsChips && (
              <div className="card fade-in" style={{ display: "grid", gap: 8 }}>
                <p className="caption muted">Back the winner (coins)</p>
                <div style={{ display: "flex", gap: 8 }}>
                  {replayOddsChips.map((c) => (
                    <button
                      key={c.name}
                      className={`outcome-row bettable ${isSelected(c.selId) ? "selected" : ""}`}
                      style={{ flex: 1, justifyContent: "space-between" }}
                      onClick={() =>
                        toggle({
                          id: c.selId,
                          fixtureId: fixture.FixtureId,
                          matchLabel: `${fixture.Participant1} vs ${fixture.Participant2}`,
                          marketKey: "1X2_PARTICIPANT_RESULT||",
                          marketLabel: "Match winner",
                          outcomeName: c.name,
                          outcomeLabel: c.label,
                          odds: c.odds,
                          session,
                          vt: Math.floor(vt),
                        })
                      }
                    >
                      <span className="team" style={{ fontSize: 12 }}>
                        {isSelected(c.selId) ? "✓ " : ""}
                        {c.label}
                      </span>
                      <span className="price-num" style={{ minWidth: 0 }}>
                        {c.odds.toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Playback controls */}
            <div className="card fade-in" style={{ display: "grid", gap: 12 }}>
              <input
                type="range"
                className="scrubber"
                min={0}
                max={timeline.duration}
                step={1}
                value={Math.floor(vt)}
                aria-label="Match timeline"
                onChange={(e) => setVt(Number(e.target.value))}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <button
                  className="pill tab active"
                  style={{ minWidth: 76, justifyContent: "center" }}
                  onClick={() => {
                    if (ended) {
                      setVt(0);
                      setPlaying(true);
                    } else {
                      setPlaying((p) => !p);
                    }
                  }}
                >
                  {ended ? "Restart" : playing ? "Pause" : "Play"}
                </button>
                <span className="clock">
                  {fmtClock(vt)} / {fmtClock(timeline.duration)}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      className={`pill tab ${speed === s ? "active" : ""}`}
                      onClick={() => setSpeed(s)}
                    >
                      x{s}
                    </button>
                  ))}
                </span>
              </div>
            </div>
          </div>

          <PredictionPanel
            fixture={fixture}
            player={player}
            onPlayerUpdate={onPlayerUpdate}
            replay={replayHooks}
          />
        </div>
      )}
    </section>
  );
}

// --- Leaderboard + share card ---------------------------------------------------------

interface LeaderRow {
  wallet_or_nickname: string;
  total_points: number;
  best_streak: number;
  current_streak: number;
  coins?: number;
}

interface SlipView {
  id: string;
  stake: number;
  combined_odds: number;
  potential_return: number;
  status: string;
  bet_legs: {
    id: string;
    outcome_label: string;
    market_label: string;
    odds: number;
    result: string;
  }[];
}

function Leaders({
  player,
  onPlayerUpdate,
}: {
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
}) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [slips, setSlips] = useState<SlipView[] | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  async function claim() {
    setClaiming(true);
    setClaimMsg(null);
    try {
      const res = await fetch("/api/coins/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: player.identity }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        if (body?.nextClaimAt) {
          const hrs = Math.ceil((body.nextClaimAt - Date.now()) / 3600_000);
          throw new Error(`Already claimed. Next 500 coins in ~${hrs}h.`);
        }
        throw new Error(body?.error ?? "Claim failed.");
      }
      onPlayerUpdate(body.player as PlayerRecord);
      setClaimMsg("+500 coins claimed! 🎉");
    } catch (err) {
      setClaimMsg(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  }

  const loadSlips = useCallback(async () => {
    try {
      const res = await fetch(`/api/slips?identity=${encodeURIComponent(player.identity)}`);
      const body = await res.json();
      if (res.ok && body.ok) {
        setSlips(body.slips as SlipView[]);
        if (body.player) onPlayerUpdate(body.player as PlayerRecord);
      }
    } catch {
      /* slips are optional garnish here */
    }
  }, [player.identity, onPlayerUpdate]);

  useEffect(() => {
    void loadSlips();
  }, [loadSlips]);

  async function onDownloadCard() {
    setShareError(null);
    try {
      const { downloadStreakCard } = await import("@/lib/share-card");
      await downloadStreakCard({
        name: displayName(player),
        streak: player.player?.current_streak ?? 0,
        points: player.player?.total_points ?? 0,
        bestStreak: player.player?.best_streak ?? 0,
      });
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Could not create the image.");
    }
  }

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
    <div className="leaders-grid">
      <div style={{ display: "grid", gap: 8 }}>
        {/* Share-my-streak card: screenshot this */}
        <section className="share-card fade-in" aria-label="Share my streak">
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
        <button className="btn btn-primary" onClick={claim} disabled={claiming}>
          {claiming ? "Claiming..." : "Claim 500 daily coins 🪙"}
        </button>
        {claimMsg && (
          <p style={{ fontSize: 13, textAlign: "center", color: "var(--color-ash)" }}>
            {claimMsg}
          </p>
        )}
        <button className="btn btn-ghost" onClick={onDownloadCard}>
          Download share card
        </button>
        {shareError && <p className="error-text">{shareError}</p>}

        {slips && slips.length > 0 && (
          <section style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <p className="caption section-label">My bets</p>
            {slips.slice(0, 6).map((s) => (
              <div key={s.id} className="row" style={{ alignItems: "flex-start" }}>
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                  {s.bet_legs.map((l) => (
                    <span key={l.id} className="team" style={{ fontSize: 12 }}>
                      {l.result === "won" ? "✓" : l.result === "lost" ? "✗" : "·"}{" "}
                      {l.outcome_label} @ {Number(l.odds).toFixed(2)}
                    </span>
                  ))}
                  <span className="muted" style={{ fontSize: 11 }}>
                    {s.stake} coins @ {Number(s.combined_odds).toFixed(2)}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color:
                      s.status === "won"
                        ? "var(--color-tape-green)"
                        : s.status === "lost"
                          ? "var(--color-festival-red)"
                          : "var(--color-fog)",
                  }}
                >
                  {s.status === "pending"
                    ? `pays ${Number(s.potential_return).toLocaleString()}`
                    : s.status.toUpperCase()}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>

      <section style={{ display: "grid", gap: "var(--element-gap)", alignSelf: "start" }}>
        <p className="caption section-label">Leaderboard</p>

        {error && <p className="error-text">{error}</p>}
        {!rows && !error && (
          <>
            <div className="skeleton" style={{ height: 48 }} />
            <div className="skeleton" style={{ height: 48, opacity: 0.75 }} />
            <div className="skeleton" style={{ height: 48, opacity: 0.5 }} />
          </>
        )}

        {rows && rows.length === 0 && (
          <p className="muted fade-in" style={{ fontSize: 14 }}>
            No players yet. Be the first on the board.
          </p>
        )}

        {rows?.map((r, i) => {
          const mine = r.wallet_or_nickname === player.identity;
          return (
            <div
              key={r.wallet_or_nickname}
              className="row fade-in"
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
                {r.coins !== undefined ? `🪙 ${r.coins.toLocaleString()}` : r.total_points}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
