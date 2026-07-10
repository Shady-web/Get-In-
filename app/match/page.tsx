"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { displayName, type PlayerRecord, type StoredPlayer } from "@/lib/player";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { authFetch } from "@/lib/api-client";
import { WalletPanel } from "@/components/wallet-panel";
import { Coin } from "@/components/coin";
import { MatchStats } from "@/components/match-stats";
import { EconomyExplainer, useEconomyExplainer } from "@/components/economy-explainer";
import { coinsToLamports, formatAmount, type Currency } from "@/lib/money";
import { MarketsPanel } from "@/components/markets-panel";
import { Flag } from "@/components/flag";
import { BetSlipProvider, BetSlipTray, useBetSlip } from "@/components/bet-slip";
import { PunditTicker } from "@/components/pundit-ticker";
import { QuestsCard } from "@/components/quests-card";
import { BadgeWall } from "@/components/badge-wall";
import type { LiveState } from "@/lib/live";
import { buildCard, isFinal, type GameCard, type GameOption, type SettledResult } from "@/lib/game-core";
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

// Replay shows recently finished matches: available from full time until
// roughly 2 hours after it. A typical match runs ~2h from kickoff, so a 4h
// cap on the kickoff age keeps it for ~2h past the final whistle.
const REPLAY_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const POLL_MS = 7_000;

type Selection = { fixture: Fixture; mode: "live" | "replay" };

function isReplayable(f: Fixture, now: number): boolean {
  return f.LiveStatus === "finished" && now - f.StartTime <= REPLAY_MAX_AGE_MS;
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
  const [player, setPlayer] = useState<StoredPlayer | null>(null);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tab, setTab] = useState<"matches" | "bets" | "rooms" | "leaders" | "wallet">("matches");
  const [openBets, setOpenBets] = useState(0);
  const [toast, setToast] = useState<{ kind: "won" | "lost" | "info"; title: string; text: string } | null>(null);
  const slipStatusRef = useRef<Map<string, string>>(new Map());
  const toastTimer = useRef<number | null>(null);
  const explainer = useEconomyExplainer();

  const showToast = useCallback((t: { kind: "won" | "lost" | "info"; title: string; text: string }) => {
    setToast(t);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4600);
  }, []);

  // Identity = the Supabase session. No session, no match screen.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      router.replace("/");
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const session = data.session;
      if (!session) {
        router.replace("/");
        return;
      }
      const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
      const label =
        (typeof meta.username === "string" && meta.username) ||
        session.user.email?.split("@")[0] ||
        "player";
      setPlayer({ identity: session.user.id, label, player: null });
      setChecked(true);
      // Bootstrap the players row + custodial devnet wallet (first login).
      try {
        const res = await authFetch("/api/player", { method: "POST" });
        const body = await res.json();
        if (!cancelled && body?.player) {
          setPlayer((prev) => (prev ? { ...prev, player: body.player } : prev));
        }
      } catch {
        /* offline bootstrap: the polls will fill the player in */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const updatePlayerRecord = useCallback((record: PlayerRecord) => {
    setPlayer((prev) => (prev ? { ...prev, player: record } : prev));
  }, []);

  // Keep the open-bets counter fresh even when the My Bets tab isn't showing.
  useEffect(() => {
    if (!checked) return;
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await authFetch("/api/slips");
        const body = await res.json();
        if (!cancelled && body?.ok && Array.isArray(body.slips)) {
          const slips = body.slips as SlipView[];
          setOpenBets(slips.filter((s) => s.status === "pending").length);
          // Toast when a slip transitions from open to a settled result.
          const prev = slipStatusRef.current;
          if (prev.size > 0) {
            for (const s of slips) {
              const was = prev.get(s.id);
              if (was === "pending" && s.status !== "pending") {
                const ccy: Currency = s.currency === "SOL" ? "SOL" : "COIN";
                if (s.status === "won") {
                  showToast({
                    kind: "won",
                    title: "YOU CALLED IT!",
                    text: `+${formatAmount(
                      ccy === "COIN"
                        ? coinsToLamports(Number(s.potential_return))
                        : Number(s.potential_return),
                      "SOL",
                    )}`,
                  });
                } else if (s.status === "lost") {
                  showToast({
                    kind: "lost",
                    title: "SO CLOSE",
                    text: `-${formatAmount(Number(s.stake), ccy)} · better luck next call`,
                  });
                }
              }
            }
          }
          slipStatusRef.current = new Map(slips.map((s) => [s.id, s.status]));
        }
      } catch {
        /* leave the last count */
      }
    };
    void tick();
    const id = window.setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [checked]);

  function signOut() {
    getSupabaseBrowser()?.auth.signOut().catch(() => {});
    router.replace("/");
  }

  if (!checked || !player) return null;

  const coins = player.player?.coin_balance;

  return (
    <BetSlipProvider>
    <main className="shell" style={{ gap: 24 }}>
      <header className="topbar">
        <div className="brand">
          GetIN<span className="bang">!!!</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {coins !== undefined && (
            <button
              className="coin-pill"
              title="How the economy works"
              onClick={explainer.openExplainer}
            >
              <Coin size={16} /> {coins.toLocaleString()}
              <span style={{ opacity: 0.6, fontSize: 11 }}>ⓘ</span>
            </button>
          )}
          <span className="pill" title={displayName(player)}>
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
        <nav style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {(
            [
              ["matches", "Matches"],
              ["bets", "My Bets"],
              ["wallet", "Wallet"],
              ["rooms", "Rooms"],
              ["leaders", "Leaders"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`pill tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {key === "bets" && openBets > 0 ? (
                <>
                  {label}{" "}
                  <span className="tab-count">{openBets}</span>
                </>
              ) : (
                label
              )}
            </button>
          ))}
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
        <>
          <QuestsCard player={player} onPlayerUpdate={updatePlayerRecord} />
          <FixtureList player={player} onPick={setSelected} />
        </>
      ) : tab === "bets" ? (
        <MyBets
          player={player}
          onPlayerUpdate={updatePlayerRecord}
          onOpenCount={setOpenBets}
        />
      ) : tab === "wallet" ? (
        <WalletPanel />
      ) : tab === "rooms" ? (
        <Rooms player={player} />
      ) : (
        <Leaders player={player} onPlayerUpdate={updatePlayerRecord} />
      )}

      <BetSlipTray player={player} onPlayerUpdate={updatePlayerRecord} />
      {explainer.open && <EconomyExplainer onClose={explainer.close} />}
      {toast && (
        <div className={`toast toast-${toast.kind} fade-in`} role="status">
          <span className="toast-icon" aria-hidden>
            {toast.kind === "won" ? "✓" : toast.kind === "lost" ? "✕" : "ℹ"}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="toast-title">{toast.title}</span>
            <span className="toast-text">{toast.text}</span>
          </span>
        </div>
      )}
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
        <span
          style={{
            fontWeight: 600,
            fontSize: 15,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <Flag country={fixture.Participant1} />
          {fixture.Participant1}
          <span className="muted" style={{ fontWeight: 400 }}>
            vs
          </span>
          <Flag country={fixture.Participant2} />
          {fixture.Participant2}
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
  const upcoming = (fixtures ?? [])
    .filter((f) => (f.LiveStatus ? f.LiveStatus === "upcoming" : f.StartTime > now))
    .sort((a, b) => a.StartTime - b.StartTime);
  // Recently finished matches you can replay (until ~2h after full time).
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

        {fixtures && live.length === 0 && (
          <div className="card fade-in" style={{ textAlign: "center", display: "grid", gap: 6 }}>
            <h2 className="heading-sm">Nothing in play right now</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              Live matches appear here the moment they kick off. Meanwhile,
              check the odds on upcoming games or replay a finished one below.
            </p>
          </div>
        )}

        {live.length > 0 && (
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
          </div>
        )}
      </section>

      {upcoming.length > 0 && (
        <section style={{ display: "grid", gap: "var(--element-gap)" }}>
          <p className="caption section-label">Coming up</p>
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
            Just-finished matches show up here to replay from full time until
            about 2 hours after. Nothing has wrapped up in that window right
            now, so check back after the next match ends.
          </p>
        )}
        <div className="fixture-grid">
          {replayable.slice(0, 8).map((f) => (
            <FixtureRow
              key={f.FixtureId}
              fixture={f}
              onClick={() => onPick({ fixture: f, mode: "replay" })}
              right={
                <span style={{ display: "grid", gap: 2, justifyItems: "end" }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    {f.LiveScore ? `${f.LiveScore.home}:${f.LiveScore.away}` : "FT"}
                  </span>
                  <span
                    style={{ color: "var(--color-orangey)", fontSize: 11, fontWeight: 600 }}
                  >
                    REPLAY
                  </span>
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
        <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
          <Flag country={fixture.Participant1} size={26} />
          <p style={{ fontWeight: 600, fontSize: 16, textAlign: "left" }}>
            {fixture.Participant1}
          </p>
        </div>
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
        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
          <Flag country={fixture.Participant2} size={26} />
          <p style={{ fontWeight: 600, fontSize: 16, textAlign: "right" }}>
            {fixture.Participant2}
          </p>
        </div>
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
      });
      if (replay) {
        qs.set("session", replay.session);
        qs.set("vt", String(Math.floor(replay.getVt())));
      }
      const res = await authFetch(`/api/game/card?${qs}`);
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
  }, [fixture, onPlayerUpdate, replay]);

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
      const res = await authFetch("/api/game/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
  const { toggle, isSelected } = useBetSlip();

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

        {/* Recent form for both teams, to size up before predicting */}
        <MatchStats fixtureId={fixture.FixtureId} />

        {/* Match-winner odds live DIRECTLY under the stats, betting-app style */}
        {state?.odds && !isFinal(state.statusId) && (
          <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
            >
              <p className="caption section-label">Match winner</p>
              <span className="muted" style={{ fontSize: 11 }}>
                tap odds · pays coins
              </span>
            </div>
            <div className="quick-odds">
              {(["part1", "draw", "part2"] as const).map((name) => {
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
                const selId = `${fixture.FixtureId}|1X2_PARTICIPANT_RESULT|||${name}`;
                return (
                  <button
                    key={name}
                    className={`odds-chip ${isSelected(selId) ? "selected" : ""}`}
                    onClick={() =>
                      toggle({
                        id: selId,
                        fixtureId: fixture.FixtureId,
                        matchLabel: `${fixture.Participant1} vs ${fixture.Participant2}`,
                        marketKey: "1X2_PARTICIPANT_RESULT||",
                        marketLabel: "Match winner",
                        outcomeName: name,
                        outcomeLabel: label,
                        odds,
                      })
                    }
                  >
                    <span className="name">
                      {isSelected(selId) ? "✓ " : ""}
                      {label}
                    </span>
                    <span className="price">{odds.toFixed(2)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view === "game" ? (
          <PredictionPanel
            fixture={fixture}
            player={player}
            onPlayerUpdate={onPlayerUpdate}
          />
        ) : (
          <MarketsPanel fixture={fixture} />
        )}

        <PunditTicker
          fixtureId={fixture.FixtureId}
          home={fixture.Participant1}
          away={fixture.Participant2}
        />
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
          <ScoreCard
            fixture={fixture}
            state={state}
            clockText={fmtClock(vt)}
            headerRight={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    color: "var(--color-orangey)",
                    fontSize: 12,
                    fontWeight: 600,
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

          {/* Tap-to-bet on the winner, directly under the stats */}
          {replayOddsChips && (
            <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <p className="caption section-label">Match winner</p>
                <span className="muted" style={{ fontSize: 11 }}>
                  replay odds · pays coins
                </span>
              </div>
              <div className="quick-odds">
                {replayOddsChips.map((c) => (
                  <button
                    key={c.name}
                    className={`odds-chip ${isSelected(c.selId) ? "selected" : ""}`}
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
                    <span className="name">
                      {isSelected(c.selId) ? "✓ " : ""}
                      {c.label}
                    </span>
                    <span className="price">{c.odds.toFixed(2)}</span>
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

          <PredictionPanel
            fixture={fixture}
            player={player}
            onPlayerUpdate={onPlayerUpdate}
            replay={replayHooks}
          />

          <PunditTicker
            fixtureId={fixture.FixtureId}
            home={fixture.Participant1}
            away={fixture.Participant2}
            getVt={getVt}
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
  currency?: "COIN" | "SOL";
  cashValue?: number | null;
  cashout_amount?: number | null;
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
        <button className="btn btn-ghost" onClick={onDownloadCard}>
          Download share card
        </button>
        {shareError && <p className="error-text">{shareError}</p>}

        <BadgeWall />
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
          const mine = r.wallet_or_nickname === (player.player?.wallet_or_nickname ?? player.label);
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
              <span
                style={{
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {r.coins !== undefined ? (
                  <>
                    <Coin size={14} /> {r.coins.toLocaleString()}
                  </>
                ) : (
                  r.total_points
                )}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// --- My Bets ---------------------------------------------------------------------

function MyBets({
  player,
  onPlayerUpdate,
  onOpenCount,
}: {
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
  onOpenCount?: (n: number) => void;
}) {
  const [slips, setSlips] = useState<SlipView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCash, setConfirmCash] = useState<SlipView | null>(null);
  const [cashing, setCashing] = useState(false);
  const [cashMsg, setCashMsg] = useState<string | null>(null);
  const prevCashRef = useRef<Map<string, number>>(new Map());
  const cashDirRef = useRef<Map<string, "up" | "down">>(new Map());

  const loadSlips = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await authFetch("/api/slips");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Could not load your bets.");
      const next = body.slips as SlipView[];
      // Track cash-value drift so the number can flash like a price.
      for (const s of next) {
        if (s.status === "pending" && typeof s.cashValue === "number") {
          const prev = prevCashRef.current.get(s.id);
          if (prev !== undefined && prev !== s.cashValue) {
            cashDirRef.current.set(s.id, s.cashValue > prev ? "up" : "down");
          }
          prevCashRef.current.set(s.id, s.cashValue);
        }
      }
      setSlips(next);
      setError(null);
      onOpenCount?.(next.filter((s) => s.status === "pending").length);
      if (body.player) onPlayerUpdate(body.player as PlayerRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your bets.");
    }
  }, [onPlayerUpdate, onOpenCount]);

  useEffect(() => {
    void loadSlips();
    const id = window.setInterval(() => void loadSlips(), 8_000);
    return () => window.clearInterval(id);
  }, [loadSlips]);

  async function cashOut(slip: SlipView) {
    setCashing(true);
    setCashMsg(null);
    try {
      const res = await authFetch("/api/slips/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slipId: slip.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Cash out failed.");
      onPlayerUpdate(body.player as PlayerRecord);
      setCashMsg(`Cashed out for ${Number(body.amount).toLocaleString()} ${confirmCash?.currency === "SOL" ? "SOL lamports" : "coins"}`);
      setConfirmCash(null);
      void loadSlips();
    } catch (err) {
      setCashMsg(err instanceof Error ? err.message : "Cash out failed.");
      setConfirmCash(null);
    } finally {
      setCashing(false);
    }
  }

  const open = (slips ?? []).filter((s) => s.status === "pending");
  const settled = (slips ?? []).filter((s) => s.status !== "pending");

  const legColor = (r: string) =>
    r === "won"
      ? "var(--color-tape-green)"
      : r === "lost"
        ? "var(--color-festival-red)"
        : r === "void"
          ? "var(--color-fog)"
          : "var(--color-snow)";

  const slipRow = (s: SlipView) => {
    const dir = cashDirRef.current.get(s.id) ?? null;
    const ccy: Currency = s.currency === "SOL" ? "SOL" : "COIN";
    const settledLegs = s.bet_legs.filter((l) => l.result !== "pending").length;
    return (
      <div key={s.id} className="row fade-in" style={{ alignItems: "flex-start" }}>
        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
          {s.bet_legs.map((l) => (
            <span
              key={l.id}
              className="team"
              style={{ fontSize: 12, color: legColor(l.result) }}
            >
              {l.result === "won" ? "✓" : l.result === "lost" ? "✗" : l.result === "void" ? "∅" : "○"}{" "}
              {l.outcome_label} @ {Number(l.odds).toFixed(2)}
            </span>
          ))}
          <span className="muted" style={{ fontSize: 11 }}>
            {formatAmount(s.stake, ccy)} @ {Number(s.combined_odds).toFixed(2)} · pays{" "}
            {formatAmount(s.potential_return, ccy)}
            {s.status === "pending" && s.bet_legs.length > 1
              ? ` · ${settledLegs}/${s.bet_legs.length} legs in`
              : ""}
          </span>
        </span>
        {s.status === "pending" && ccy === "SOL" && typeof s.cashValue === "number" ? (
          <button
            className="cashout-btn"
            onClick={() => setConfirmCash(s)}
            aria-label={`Cash out for ${formatAmount(s.cashValue, ccy)}`}
          >
            <span className="caption" style={{ color: "var(--color-fog)" }}>
              Cash out
            </span>
            <span
              key={`${s.id}:${s.cashValue}`}
              className={`cash-value ${dir ? `flash-${dir}` : ""}`}
            >
              {dir === "up" ? "▲" : dir === "down" ? "▼" : ""}{" "}
              {`${(s.cashValue / 1e9).toFixed(3)}◎`}
            </span>
          </button>
        ) : s.status === "pending" && ccy === "COIN" ? (
          <button
            className="cashout-btn"
            disabled
            aria-label="Cash out unavailable"
            title="Coin calls settle at full time and pay out in SOL"
            style={{ opacity: 0.55, cursor: "default" }}
          >
            <span className="caption" style={{ color: "var(--color-fog)" }}>
              Cash out
            </span>
            <span className="cash-value" style={{ fontSize: 12 }}>
              Unavailable
            </span>
          </button>
        ) : (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              textAlign: "right",
              color:
                s.status === "won"
                  ? "var(--color-tape-green)"
                  : s.status === "lost"
                    ? "var(--color-festival-red)"
                    : s.status === "cashed"
                      ? "var(--color-ember-orange)"
                      : "var(--color-fog)",
            }}
          >
            {s.status === "pending"
              ? "open"
              : s.status === "cashed"
                ? `CASHED +${formatAmount(Number(s.cashout_amount ?? 0), ccy)}`
                : s.status === "won"
                  ? `WON +${formatAmount(
                      ccy === "COIN"
                        ? coinsToLamports(Number(s.potential_return))
                        : Number(s.potential_return),
                      "SOL",
                    )}`
                  : s.status.toUpperCase()}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: "var(--element-gap)" }}>
      {cashMsg && (
        <p style={{ fontSize: 13, textAlign: "center", color: "var(--color-ash)" }}>
          {cashMsg}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      {!slips && !error && (
        <>
          <div className="skeleton" style={{ height: 64 }} />
          <div className="skeleton" style={{ height: 64, opacity: 0.6 }} />
        </>
      )}

      {slips && slips.length === 0 && (
        <div className="card fade-in" style={{ textAlign: "center", display: "grid", gap: 6 }}>
          <h2 className="heading-sm">No bets yet</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Open any match, tap a price in Markets (or the winner odds in a
            replay) and place your first slip. It shows up here with a live
            cash-out value.
          </p>
        </div>
      )}

      {open.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <p className="caption section-label">Open ({open.length})</p>
          {open.map(slipRow)}
        </section>
      )}

      {settled.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <p className="caption muted">Settled</p>
          {settled.slice(0, 12).map(slipRow)}
        </section>
      )}

      {confirmCash && (
        <div className="slip-sheet fade-in" role="dialog" aria-label="Confirm cash out">
          <p className="caption section-label">Cash out</p>
          <p style={{ fontSize: 14 }}>
            Cash this slip out now for about{" "}
            <strong style={{ color: "var(--color-ember-orange)" }}>
              {formatAmount(
                Number(confirmCash.cashValue ?? 0),
                confirmCash.currency === "SOL" ? "SOL" : "COIN",
              )}
            </strong>
            ? The final amount is repriced at confirm (odds move), and the slip
            closes for good.
          </p>
          <button
            className="btn btn-primary"
            disabled={cashing}
            onClick={() => void cashOut(confirmCash)}
          >
            {cashing ? "Cashing out..." : "Confirm cash out"}
          </button>
          <button className="btn btn-ghost" disabled={cashing} onClick={() => setConfirmCash(null)}>
            Keep the bet running
          </button>
        </div>
      )}
    </div>
  );
}

// --- Private rooms ------------------------------------------------------------------

interface RoomInfo {
  id: string;
  code: string;
  name: string;
  members: number;
}

interface RoomStanding {
  name: string;
  coins: number;
  profit: number;
}

function Rooms({ player }: { player: StoredPlayer }) {
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [active, setActive] = useState<RoomInfo | null>(null);
  const [standings, setStandings] = useState<RoomStanding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Rank tracking for the change animations.
  const prevRankRef = useRef<Map<string, number>>(new Map());
  const rankDirRef = useRef<Map<string, "up" | "down">>(new Map());

  const loadRooms = useCallback(async () => {
    try {
      const res = await authFetch("/api/rooms");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Rooms unavailable.");
      setRooms(body.rooms as RoomInfo[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rooms unavailable.");
    }
  }, []);

  const loadStandings = useCallback(async (code: string) => {
    try {
      const res = await fetch(`/api/rooms/${code}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Room unavailable.");
      const next = body.standings as RoomStanding[];
      next.forEach((s, i) => {
        const prev = prevRankRef.current.get(s.name);
        if (prev !== undefined && prev !== i) {
          rankDirRef.current.set(s.name, i < prev ? "up" : "down");
        }
        prevRankRef.current.set(s.name, i);
      });
      setStandings(next);
      setActive(body.room as RoomInfo);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Room unavailable.");
    }
  }, []);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  // Share links land on /match?room=CODE: auto-join once identity exists.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room");
    if (!code || !/^[A-Za-z0-9]{6}$/.test(code)) return;
    window.history.replaceState(null, "", "/match");
    void (async () => {
      try {
        const res = await authFetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = await res.json();
        if (res.ok && body.ok) {
          await loadRooms();
          await loadStandings(body.room.code);
        }
      } catch {
        /* bad link: the rooms list still renders */
      }
    })();
  }, [loadRooms, loadStandings]);

  // Live standings: refetch on any players change (realtime) or every 10s.
  useEffect(() => {
    if (!active) return;
    const supabase = getSupabaseBrowser();
    if (supabase) {
      const channel = supabase
        .channel(`room-${active.code}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => {
          void loadStandings(active.code);
        })
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    }
    const id = window.setInterval(() => void loadStandings(active.code), 10_000);
    return () => window.clearInterval(id);
  }, [active, loadStandings]);

  async function act(payload: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Room action failed.");
      setJoinCode("");
      setNewName("");
      await loadRooms();
      await loadStandings(body.room.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Room action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!active) return;
    const link = `${window.location.origin}/match?room=${active.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy the invite link:", link);
    }
  }

  const shortName = (n: string) =>
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(n) ? `${n.slice(0, 4)}...${n.slice(-4)}` : n;

  // --- Room detail view ---
  if (active) {
    return (
      <div style={{ display: "grid", gap: "var(--element-gap)" }}>
        <button
          className="pill"
          onClick={() => {
            setActive(null);
            setStandings(null);
            prevRankRef.current.clear();
            rankDirRef.current.clear();
          }}
          style={{ cursor: "pointer", justifySelf: "start", color: "var(--color-fog)" }}
        >
          ← My rooms
        </button>

        <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="caption section-label">{active.name}</p>
            <span className="muted" style={{ fontSize: 12 }}>
              {active.members} {active.members === 1 ? "player" : "players"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="room-code">{active.code}</span>
            <button className="btn btn-ghost" style={{ width: "auto", minHeight: 40 }} onClick={copyLink}>
              {copied ? "Link copied ✓" : "Copy invite link"}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Friends join with the code or the link. Ranked by coin profit since
            joining this room.
          </p>
        </div>

        <section style={{ display: "grid", gap: 8 }}>
          <p className="caption section-label">Room standings</p>
          {!standings && <div className="skeleton" style={{ height: 120 }} />}
          {standings?.map((s, i) => {
            const mine = s.name === (player.player?.wallet_or_nickname ?? player.label);
            const dir = rankDirRef.current.get(s.name) ?? null;
            return (
              <div
                key={`${s.name}:${i}`}
                className={`row fade-in ${dir ? `rank-${dir}` : ""}`}
                style={mine ? { border: "1px solid var(--color-slate)" } : undefined}
              >
                <span className="muted" style={{ width: 26, fontVariantNumeric: "tabular-nums" }}>
                  {i === 0 ? "🏆" : i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: mine ? 600 : 400, minWidth: 0 }} className="team">
                  {shortName(s.name)}
                  {dir === "up" ? " ▲" : dir === "down" ? " ▼" : ""}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color:
                      s.profit > 0
                        ? "var(--color-tape-green)"
                        : s.profit < 0
                          ? "var(--color-festival-red)"
                          : "var(--color-fog)",
                  }}
                >
                  {s.profit > 0 ? "+" : ""}
                  {s.profit.toLocaleString()}
                </span>
              </div>
            );
          })}
        </section>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  // --- Rooms list / create / join ---
  return (
    <div style={{ display: "grid", gap: "var(--element-gap)" }}>
      <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
        <p className="caption section-label">Create a room</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            placeholder="Room name (optional)"
            value={newName}
            maxLength={40}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="btn btn-primary"
            style={{ width: "auto", flex: "none" }}
            disabled={busy}
            onClick={() => void act({ name: newName })}
          >
            Create
          </button>
        </div>
        <div className="divider">or join with a code</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            placeholder="6-char code"
            value={joinCode}
            maxLength={6}
            style={{ textTransform: "uppercase", letterSpacing: 2 }}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && joinCode.length === 6 && void act({ code: joinCode })}
          />
          <button
            className="btn btn-ghost"
            style={{ width: "auto", flex: "none" }}
            disabled={busy || joinCode.length !== 6}
            onClick={() => void act({ code: joinCode })}
          >
            Join
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      <section style={{ display: "grid", gap: 8 }}>
        <p className="caption section-label">My rooms</p>
        {!rooms && !error && <div className="skeleton" style={{ height: 64 }} />}
        {rooms && rooms.length === 0 && (
          <p className="muted fade-in" style={{ fontSize: 14 }}>
            No rooms yet. Create one and send your friends the code.
          </p>
        )}
        {rooms?.map((r) => (
          <button
            key={r.id}
            className="row fixture-row fade-in"
            onClick={() => void loadStandings(r.code)}
          >
            <span style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{r.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {r.members} {r.members === 1 ? "player" : "players"}
              </span>
            </span>
            <span className="room-code" style={{ fontSize: 13 }}>
              {r.code}
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}
