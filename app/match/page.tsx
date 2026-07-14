"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { displayName, type PlayerRecord, type StoredPlayer } from "@/lib/player";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { authFetch } from "@/lib/api-client";
import { WalletPanel } from "@/components/wallet-panel";
import { Coin } from "@/components/coin";
import { Solana } from "@/components/solana";
import { WcBadge } from "@/components/wc-badge";
import { MatchStats } from "@/components/match-stats";
import { EconomyExplainer, useEconomyExplainer } from "@/components/economy-explainer";
import { coinsToLamports, formatAmount, type Currency } from "@/lib/money";
import { solPriceNow } from "@/lib/use-sol-price";
import { MarketsPanel } from "@/components/markets-panel";
import { Flag } from "@/components/flag";
import { BetSlipProvider, BetSlipTray, useBetSlip } from "@/components/bet-slip";
import { PunditTicker } from "@/components/pundit-ticker";
import { QuestsCard } from "@/components/quests-card";
import { DailyBonus } from "@/components/daily-bonus";
import { BadgeWall } from "@/components/badge-wall";
import { BetSlipDetail } from "@/components/bet-detail";
import { MatchEventsCard } from "@/components/match-events-card";
import { ReplayMarkets } from "@/components/replay-markets";
import type { LiveState } from "@/lib/live";
import { isFinal } from "@/lib/game-core";
import { winnerOdds, isIndicativeOdds } from "@/lib/odds";
import { useAutoClear } from "@/lib/use-auto-clear";
import { stateAt, type ReplayTimeline } from "@/lib/replay-core";
import {
  ArrowLeft,
  Check,
  ChevronUp,
  ChevronDown,
  CircleCheck,
  CircleX,
  Info,
} from "lucide-react";
import { ResultIcon } from "@/components/icons";
import { SEED_REPLAY_FIXTURES, PINNED_REPLAY_IDS } from "@/lib/seed-replay";
import { Landing } from "@/components/landing";

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

// Replay shows finished matches for up to 3 weeks after kickoff, so you can
// re-watch any game from the tournament so far (subject to the feed still
// carrying its history).
// Generous window so finished matches stay replayable across the whole
// tournament + judging period; the seeded replay is always there regardless.
const REPLAY_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const SEED_REPLAY_IDS = new Set(SEED_REPLAY_FIXTURES.map((f) => f.FixtureId));
const POLL_MS = 7_000;

type Selection = { fixture: Fixture; mode: "live" | "replay" };

function isReplayable(f: Fixture, now: number): boolean {
  return f.LiveStatus === "finished" && now - f.StartTime <= REPLAY_MAX_AGE_MS;
}

// --- Bottom-nav icons (inline SVG keeps the tab bar crisp, no assets) ---------

const NAV_ICONS: Record<string, React.ReactNode> = {
  matches: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path
        d="M12 7.6l4.2 3-1.6 4.9H9.4l-1.6-4.9z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M12 3v4.6M20.6 10l-4.4.6M17.5 19.3l-2.9-3.8M6.5 19.3l2.9-3.8M3.4 10l4.4.6" />
    </svg>
  ),
  bets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v1.6a2 2 0 0 0 0 3.8v1.6a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 15.5v-1.6a2 2 0 0 0 0-3.8z" />
      <path d="M14.5 7v10" strokeDasharray="1.6 2.4" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="3.5" y="6" width="17" height="13" rx="2.5" />
      <path d="M16.5 6V5a1.5 1.5 0 0 0-1.8-1.5L5 5.4" />
      <path d="M15.5 11h5v3.5h-5a1.75 1.75 0 1 1 0-3.5z" />
    </svg>
  ),
  leaders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M8 4h8v4.5a4 4 0 0 1-8 0z" />
      <path d="M8 5.5H5.5a0 0 0 0 0 0 0c0 2.5 1 4 2.8 4.4M16 5.5h2.5c0 2.5-1 4-2.8 4.4" />
      <path d="M12 12.5v3M9 20h6M10 15.5h4l.6 4.5H9.4z" />
    </svg>
  ),
};

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
  const [tab, setTab] = useState<"matches" | "bets" | "leaders" | "wallet" | "account">("matches");
  const [email, setEmail] = useState<string | null>(null);
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

  // The app is public: guests browse matches, odds, replays and the board.
  // A Supabase session unlocks betting, the wallet, quests and My Bets. No
  // session just means guest mode - never a redirect to login.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setChecked(true); // no auth configured: browse as a guest
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const session = data.session;
      if (!session) {
        setChecked(true); // guest
        return;
      }
      const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
      const label =
        (typeof meta.username === "string" && meta.username) ||
        session.user.email?.split("@")[0] ||
        "player";
      setPlayer({ identity: session.user.id, label, player: null });
      setEmail(session.user.email ?? null);
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

  // Guests show no account data. If there's no player (fresh guest, sign out,
  // or a session that silently expired), keep the open-bets badge cleared.
  useEffect(() => {
    if (!player) setOpenBets(0);
  }, [player]);

  // Keep the open-bets counter fresh even when the My Bets tab isn't showing.
  // Guests have no bets, so only poll once signed in.
  useEffect(() => {
    if (!checked || !player?.identity) return;
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
                        ? coinsToLamports(Number(s.potential_return), solPriceNow())
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

  // Browser Back / edge-swipe should step back THROUGH the app (a match view
  // returns to the match list, an inner tab returns to Matches) instead of
  // leaving straight to /login. We keep exactly one history "trap" entry while
  // the user is in any non-root view; a back gesture pops it and we restore the
  // root view instead of navigating away. Only a back from the root itself
  // leaves the app.
  const atRoot = !selected && tab === "matches";
  const trapRef = useRef(false);
  useEffect(() => {
    if (!atRoot && !trapRef.current) {
      trapRef.current = true;
      window.history.pushState({ giTrap: true }, "");
    } else if (atRoot && trapRef.current) {
      // Returned to root via in-app controls: drop the now-unneeded trap entry.
      trapRef.current = false;
      window.history.back();
    }
  }, [atRoot]);
  useEffect(() => {
    const onPop = () => {
      if (!trapRef.current) return; // at root: let the browser navigate normally
      trapRef.current = false;
      setSelected(null);
      setTab("matches");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function signOut() {
    getSupabaseBrowser()?.auth.signOut().catch(() => {});
    setPlayer(null);
    setEmail(null);
    setOpenBets(0);
    slipStatusRef.current = new Map();
    setTab("matches");
    setSelected(null);
  }
  const goLogin = (signup?: boolean) =>
    router.push(signup ? "/login?mode=signup" : "/login");

  // While the session check resolves, keep the app shell (header + nav +
  // devnet banner) on screen with a skeleton body instead of a blank page, so
  // navigation never disappears. Guests then get the full browse experience;
  // betting/wallet/quests need a login.
  const loading = !checked;
  const guest = !player;
  const coins = player?.player?.coin_balance;
  const solLamports = player?.player?.sol_balance;

  return (
    <BetSlipProvider>
    <main className="shell" style={{ gap: 24 }}>
      <header className="topbar">
        <div className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <WcBadge size={26} />
          <span style={{ display: "flex", alignItems: "baseline", gap: 1 }}>
            GetIN<span className="bang">!!!</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {loading ? (
            <span className="skeleton" style={{ width: 120, height: 30, borderRadius: 999 }} />
          ) : guest ? (
            <>
              <button
                className="pill tab"
                style={{ cursor: "pointer" }}
                onClick={() => goLogin(false)}
              >
                Log in
              </button>
              <button
                className="pill join-pill"
                style={{ cursor: "pointer" }}
                onClick={() => goLogin(true)}
              >
                Join now
              </button>
            </>
          ) : (
            <>
              {coins !== undefined && (
                <button
                  className="coin-pill"
                  title="How the economy works"
                  onClick={explainer.openExplainer}
                >
                  <Coin size={15} /> {coins.toLocaleString()}
                </button>
              )}
              {solLamports !== undefined && (
                <button
                  className="sol-pill"
                  title="Playable SOL balance · open Wallet"
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setSelected(null);
                    setTab("wallet");
                  }}
                >
                  <Solana size={15} />{" "}
                  {(solLamports / 1_000_000_000).toLocaleString(undefined, {
                    maximumFractionDigits: 3,
                  })}
                </button>
              )}
              <button
                className={`avatar-btn ${tab === "account" ? "active" : ""}`}
                title={`${displayName(player!)} · account`}
                aria-label="Account"
                onClick={() => {
                  setSelected(null);
                  setTab("account");
                }}
              >
                {displayName(player!).charAt(0).toUpperCase()}
              </button>
            </>
          )}
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Main">
        {(
          [
            ["matches", "Matches"],
            ["bets", "My Bets"],
            ["wallet", "Wallet"],
            ["leaders", "Leaders"],
          ] as const
        ).map(([key, label]) => {
          // With a match open, the Matches tab reads as the active section.
          const active = selected ? key === "matches" : tab === key;
          return (
            <button
              key={key}
              className={`nav-item ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setSelected(null);
                setTab(key);
              }}
            >
              {NAV_ICONS[key]}
              <span>{label}</span>
              {key === "bets" && !guest && openBets > 0 && (
                <span className="nav-badge">{openBets}</span>
              )}
            </button>
          );
        })}
      </nav>

      {loading ? (
        <div style={{ display: "grid", gap: "var(--element-gap)" }}>
          <div className="skeleton" style={{ height: 96 }} />
          <div className="skeleton" style={{ height: 72, opacity: 0.7 }} />
          <div className="skeleton" style={{ height: 72, opacity: 0.5 }} />
        </div>
      ) : selected ? (
        selected.mode === "live" ? (
          <LiveMatch fixture={selected.fixture} onBack={() => setSelected(null)} />
        ) : (
          <ReplayMatch
            fixture={selected.fixture}
            onBack={() => setSelected(null)}
            onPlayerUpdate={updatePlayerRecord}
          />
        )
      ) : tab === "matches" ? (
        <>
          {guest && (
            <Landing
              onJoin={() => goLogin(true)}
              onBrowse={() =>
                document.getElementById("gi-matches")?.scrollIntoView({ behavior: "smooth" })
              }
            />
          )}
          {player && <DailyBonus player={player} onPlayerUpdate={updatePlayerRecord} />}
          {player && <QuestsCard player={player} onPlayerUpdate={updatePlayerRecord} />}
          <div id="gi-matches" style={{ scrollMarginTop: 72 }}>
            <FixtureList onPick={setSelected} />
          </div>
        </>
      ) : tab === "bets" ? (
        player ? (
          <MyBets
            player={player}
            onPlayerUpdate={updatePlayerRecord}
            onOpenCount={setOpenBets}
            onBrowse={() => setTab("matches")}
          />
        ) : (
          <AuthGate title="Log in to place a bet" onLogin={goLogin} />
        )
      ) : tab === "wallet" ? (
        player ? (
          <WalletPanel
            onPlayerUpdate={updatePlayerRecord}
            solLamports={solLamports}
            coinBalance={coins}
          />
        ) : (
          <AuthGate title="Log in to open your wallet" onLogin={goLogin} />
        )
      ) : tab === "account" && player ? (
        <AccountPanel
          player={player}
          email={email}
          onSignOut={signOut}
          onBack={() => setTab("matches")}
        />
      ) : (
        // The leaderboard is public (read-only for guests); betting/wallet
        // still need a login, but the board is part of "selling the product".
        <Leaders player={player} />
      )}

      <BetSlipTray
        player={player}
        onPlayerUpdate={updatePlayerRecord}
        onRequireLogin={() => goLogin(true)}
      />
      {explainer.open && <EconomyExplainer onClose={explainer.close} />}
      {toast && (
        <div className={`toast toast-${toast.kind} fade-in`} role="status">
          <span className="toast-icon" aria-hidden>
            {toast.kind === "won" ? (
              <CircleCheck size={18} />
            ) : toast.kind === "lost" ? (
              <CircleX size={18} />
            ) : (
              <Info size={18} />
            )}
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

// --- Auth gate (guest sees this on bets / wallet) -----------------------------

function AuthGate({
  title,
  body,
  onLogin,
}: {
  title: string;
  body?: string;
  onLogin: (signup?: boolean) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "var(--element-gap)", maxWidth: 440, margin: "0 auto", width: "100%" }}>
      <div
        className="card fade-in"
        style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center", padding: "34px 20px" }}
      >
        <WcBadge size={56} />
        <div style={{ display: "grid", gap: 5 }}>
          <h2 className="heading-sm">{title}</h2>
          {body && (
            <p className="muted" style={{ fontSize: 14, maxWidth: 320 }}>
              {body}
            </p>
          )}
        </div>
        <div style={{ display: "grid", gap: 8, width: "100%", maxWidth: 280 }}>
          <button className="btn btn-primary" onClick={() => onLogin(true)}>
            Join now
          </button>
          <button className="btn btn-ghost" onClick={() => onLogin(false)}>
            Log in
          </button>
        </div>
        <p className="caption muted">Free · devnet test tokens · no real value</p>
      </div>
    </div>
  );
}

// --- Account (sign out + delete) ----------------------------------------------

function AccountPanel({
  player,
  email,
  onSignOut,
  onBack,
}: {
  player: StoredPlayer;
  email: string | null;
  onSignOut: () => void;
  onBack: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = displayName(player);

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      const res = await authFetch("/api/account/delete", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Could not delete the account.");
      // Account is gone: clear the session and drop back to the login screen.
      onSignOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account.");
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--element-gap)", maxWidth: 480, margin: "0 auto", width: "100%" }}>
      <button
        className="pill"
        onClick={onBack}
        style={{ cursor: "pointer", justifySelf: "start", color: "var(--color-fog)", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <ArrowLeft size={14} aria-hidden /> Back
      </button>

      {/* Identity card */}
      <div className="card fade-in" style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center", padding: "26px 18px" }}>
        <span className="avatar-lg" aria-hidden>
          {name.charAt(0).toUpperCase()}
        </span>
        <div style={{ display: "grid", gap: 2 }}>
          <p className="heading-sm">{name}</p>
          {email && (
            <p className="muted" style={{ fontSize: 13 }}>
              {email}
            </p>
          )}
        </div>
        <button className="btn btn-ghost" onClick={onSignOut} style={{ maxWidth: 260 }}>
          Sign out
        </button>
      </div>

      {/* Danger zone */}
      <div
        className="card fade-in"
        style={{ display: "grid", gap: 12, borderColor: "rgba(255, 122, 122, 0.32)" }}
      >
        <p className="caption" style={{ color: "var(--color-festival-red)", letterSpacing: "0.12em" }}>
          Danger zone
        </p>
        {!confirming ? (
          <>
            <p className="muted" style={{ fontSize: 13 }}>
              Permanently delete your account, balance and every bet you have
              placed. This can&apos;t be undone.
            </p>
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>
              Delete account
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, fontWeight: 700 }}>
              Delete your account?
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              This removes your account and all your data for good. There is no
              way to get it back.
            </p>
            <button
              className="btn btn-danger"
              disabled={deleting}
              onClick={() => void deleteAccount()}
            >
              {deleting ? "Deleting…" : "Yes, delete my account"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
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
  // Teams stack one per line (never wrap mid-name), so every card in the
  // list renders the same shape no matter how long the country names are.
  const teamLine: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontWeight: 600,
    fontSize: 14.5,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  };
  return (
    <button className="row fixture-row fade-in" onClick={onClick}>
      {left}
      <span style={{ flex: 1, display: "grid", gap: 4, minWidth: 0 }}>
        <span style={teamLine}>
          <Flag country={fixture.Participant1} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {fixture.Participant1}
          </span>
        </span>
        <span style={teamLine}>
          <Flag country={fixture.Participant2} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {fixture.Participant2}
          </span>
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {fixture.Competition}
        </span>
      </span>
      {right}
    </button>
  );
}

function FixtureList({ onPick }: { onPick: (s: Selection) => void }) {
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
  // Finished matches you can replay, newest first. Real fixtures named in
  // NEXT_PUBLIC_PINNED_REPLAY_IDS are pinned on top once they've finished (e.g.
  // the real France–Spain after it's played); until then the always-available
  // seeded demo is pinned so Replay Mode is never empty. When a pinned real
  // match is available, the demo steps aside so the real replay takes over.
  const pinnedReal = PINNED_REPLAY_IDS
    .map((id) => (fixtures ?? []).find((f) => f.FixtureId === id && f.LiveStatus === "finished"))
    .filter((f): f is Fixture => Boolean(f));
  const seedFixtures = pinnedReal.length === 0 ? (SEED_REPLAY_FIXTURES as Fixture[]) : [];
  const pinnedIds = new Set<number>([...PINNED_REPLAY_IDS, ...SEED_REPLAY_IDS]);
  const feedReplays = (fixtures ?? [])
    .filter((f) => isReplayable(f, now) && !pinnedIds.has(f.FixtureId))
    .sort((a, b) => b.StartTime - a.StartTime);
  const replayable = [...pinnedReal, ...seedFixtures, ...feedReplays];

  return (
    <>
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
            Finished matches stay here to replay for up to 3 weeks after
            kickoff. Nothing has wrapped up in that window yet, so check back
            after the next match ends.
          </p>
        )}
        <div className="fixture-grid">
          {replayable.slice(0, 40).map((f) => (
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
                  <span className="muted" style={{ fontSize: 10.5 }}>
                    {kickoffLabel(f.StartTime)}
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

// --- Replay settlement heartbeat ---------------------------------------------------

/**
 * Invisible: while a replay plays, poll the settle endpoint with the virtual
 * clock so bets placed in the replay settle at its full time (live bets
 * settle from the global My Bets poll and at read time in /api/slips).
 */
function ReplaySettler({
  fixtureId,
  session,
  getVt,
  onPlayerUpdate,
}: {
  fixtureId: number;
  session: string;
  getVt: () => number;
  onPlayerUpdate: (p: PlayerRecord) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const qs = new URLSearchParams({
          fixtureId: String(fixtureId),
          session,
          vt: String(Math.floor(getVt())),
        });
        const res = await authFetch(`/api/settle?${qs}`);
        const body = await res.json();
        if (!cancelled && body?.ok && body.player) {
          onPlayerUpdate(body.player as PlayerRecord);
        }
      } catch {
        /* transient: the next tick retries */
      }
    };
    const id = window.setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [fixtureId, session, getVt, onPlayerUpdate]);
  return null;
}

// --- Live match view -----------------------------------------------------------

function LiveMatch({
  fixture,
  onBack,
}: {
  fixture: Fixture;
  onBack: () => void;
}) {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockText, setClockText] = useState<string | null>(null);
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
          style={{ cursor: "pointer", color: "var(--color-fog)", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <ArrowLeft size={14} aria-hidden /> Matches
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

        {/* Match-winner odds live DIRECTLY under the stats, betting-app style.
            Always available before full time, even before a book opens - the
            odds fall back to the win-probability split, then a flat default. */}
        {state && !isFinal(state.statusId) && (() => {
          const wo = winnerOdds(state);
          const indicative = isIndicativeOdds(state);
          return (
          <div className="card fade-in" style={{ display: "grid", gap: 10 }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
            >
              <p className="caption section-label">Match winner</p>
              <span className="muted" style={{ fontSize: 11 }}>
                {indicative ? "indicative · tap to bet" : "tap odds · pays coins"}
              </span>
            </div>
            <div className="quick-odds">
              {(["part1", "draw", "part2"] as const).map((name) => {
                const odds =
                  name === "part1" ? wo.home : name === "part2" ? wo.away : wo.draw;
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
                    <span className="name" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {isSelected(selId) && (
                        <Check size={13} aria-hidden style={{ color: "var(--color-lime)", flex: "none" }} />
                      )}
                      {label}
                    </span>
                    <span className="price">{odds.toFixed(2)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          );
        })()}

        <MarketsPanel fixture={fixture} />

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
  onBack,
  onPlayerUpdate,
}: {
  fixture: Fixture;
  onBack: () => void;
  // Absent for guests: their replay bets aren't settled (they can't place any).
  onPlayerUpdate?: (p: PlayerRecord) => void;
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

  const getVt = useCallback(() => vtRef.current, []);

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
        style={{ cursor: "pointer", justifySelf: "start", color: "var(--color-fog)", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <ArrowLeft size={14} aria-hidden /> Matches
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
                    <span className="name" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {isSelected(c.selId) && (
                        <Check size={13} aria-hidden style={{ color: "var(--color-lime)", flex: "none" }} />
                      )}
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

          {onPlayerUpdate && (
            <ReplaySettler
              fixtureId={fixture.FixtureId}
              session={session}
              getVt={getVt}
              onPlayerUpdate={onPlayerUpdate}
            />
          )}

          {state && !ended && (
            <ReplayMarkets
              fixture={fixture}
              state={state}
              session={session}
              vt={vt}
            />
          )}

          <MatchEventsCard
            events={timeline.events}
            vt={vt}
            home={fixture.Participant1}
            away={fixture.Participant2}
          />

          <PunditTicker
            fixtureId={fixture.FixtureId}
            home={fixture.Participant1}
            away={fixture.Participant2}
            getVt={getVt}
            askable
          />
        </div>
      )}
    </section>
  );
}

// --- Leaderboard + share card ---------------------------------------------------------

interface LeaderRow {
  wallet_or_nickname: string;
  coins: number;
  sol: number; // lamports
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

function Leaders({ player }: { player: StoredPlayer | null }) {
  const [boards, setBoards] = useState<{ byCoins: LeaderRow[]; bySol: LeaderRow[] } | null>(null);
  const [mode, setMode] = useState<"coins" | "sol">("coins");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Leaderboard unavailable.");
      setBoards({ byCoins: body.byCoins ?? [], bySol: body.bySol ?? [] });
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

  const rows = boards ? (mode === "coins" ? boards.byCoins : boards.bySol) : null;
  const shortName = (n: string) =>
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(n) ? `${n.slice(0, 4)}...${n.slice(-4)}` : n;

  return (
    <div className="leaders-grid">
      <div style={{ display: "grid", gap: 8 }}>
        <BadgeWall />
      </div>

      <section style={{ display: "grid", gap: "var(--element-gap)", alignSelf: "start" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p className="caption section-label">Leaderboard</p>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`pill tab ${mode === "coins" ? "active" : ""}`}
              style={{ gap: 5 }}
              onClick={() => setMode("coins")}
            >
              <Coin size={13} /> Coins
            </button>
            <button
              className={`pill tab ${mode === "sol" ? "active" : ""}`}
              style={{ gap: 5 }}
              onClick={() => setMode("sol")}
            >
              <Solana size={13} /> SOL
            </button>
          </div>
        </div>

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
          const mine =
            !!player && r.wallet_or_nickname === (player.player?.wallet_or_nickname ?? player.label);
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
              <span
                className="mono"
                style={{
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {mode === "coins" ? (
                  <>
                    <Coin size={14} /> {r.coins.toLocaleString()}
                  </>
                ) : (
                  <>
                    <Solana size={14} /> {(r.sol / 1e9).toFixed(3)}
                  </>
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
  onBrowse,
}: {
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
  onOpenCount?: (n: number) => void;
  onBrowse?: () => void;
}) {
  const [slips, setSlips] = useState<SlipView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCash, setConfirmCash] = useState<SlipView | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cashing, setCashing] = useState(false);
  const [cashMsg, setCashMsg] = useState<string | null>(null);
  useAutoClear(cashMsg, setCashMsg, 5000);
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
      <div
        key={s.id}
        className="row fade-in"
        style={{ alignItems: "flex-start", cursor: "pointer" }}
        role="button"
        tabIndex={0}
        onClick={() => setDetailId(s.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDetailId(s.id);
          }
        }}
      >
        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
          {s.bet_legs.map((l) => (
            <span
              key={l.id}
              className="team"
              style={{ fontSize: 12, color: legColor(l.result), display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <ResultIcon result={l.result} size={12} />
              <span style={{ minWidth: 0 }}>
                {l.outcome_label} @ {Number(l.odds).toFixed(2)}
              </span>
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
            onClick={(e) => {
              e.stopPropagation();
              setConfirmCash(s);
            }}
            aria-label={`Cash out for ${formatAmount(s.cashValue, ccy)}`}
          >
            <span className="caption" style={{ color: "var(--color-fog)" }}>
              Cash out
            </span>
            <span
              key={`${s.id}:${s.cashValue}`}
              className={`cash-value ${dir ? `flash-${dir}` : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
            >
              {dir === "up" ? (
                <ChevronUp size={12} aria-hidden />
              ) : dir === "down" ? (
                <ChevronDown size={12} aria-hidden />
              ) : null}
              {(s.cashValue / 1e9).toFixed(3)} <Solana size={12} />
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
                        ? coinsToLamports(Number(s.potential_return), solPriceNow())
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
        <div className="card fade-in" style={{ textAlign: "center", display: "grid", gap: 10, justifyItems: "center" }}>
          <h2 className="heading-sm">No bets yet</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Open any match, tap a price in Markets (or the winner odds in a
            replay) and place your first slip. It shows up here with a live
            cash-out value.
          </p>
          {onBrowse && (
            <button className="btn btn-primary" style={{ maxWidth: 220 }} onClick={onBrowse}>
              Browse matches
            </button>
          )}
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

      {detailId && (
        <BetSlipDetail slipId={detailId} onClose={() => setDetailId(null)} />
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
