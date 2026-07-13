"use client";

// Bet Slip: tap odds anywhere to collect selections; one = single, many
// (across matches) = accumulator. Slide-up sheet to stake coins and place.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { PlayerRecord, StoredPlayer } from "@/lib/player";
import { Coin } from "@/components/coin";
import { Solana } from "@/components/solana";
import { useAutoClear } from "@/lib/use-auto-clear";
import {
  coinsToLamports,
  formatAmount,
  MIN_STAKE,
  parseStake,
  stakePlaceholder,
  type Currency,
} from "@/lib/money";
import { authFetch } from "@/lib/api-client";

export interface SlipSelection {
  id: string; // matchScope|marketKey|outcomeName
  fixtureId: number;
  matchLabel: string; // "Ghana vs Japan"
  marketKey: string;
  marketLabel: string;
  outcomeName: string;
  outcomeLabel: string;
  odds: number; // advisory: server re-prices at placement
  session?: string | null;
  vt?: number | null;
}

interface BetSlipContextValue {
  selections: SlipSelection[];
  toggle: (sel: SlipSelection) => void;
  remove: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
}

const BetSlipContext = createContext<BetSlipContextValue | null>(null);

export function useBetSlip(): BetSlipContextValue {
  const ctx = useContext(BetSlipContext);
  if (!ctx) throw new Error("useBetSlip must be used inside BetSlipProvider");
  return ctx;
}

const STORAGE_KEY = "getin.slip";

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<SlipSelection[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSelections(JSON.parse(raw));
    } catch {
      /* fresh slip */
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
  }, [selections]);

  const toggle = useCallback((sel: SlipSelection) => {
    setSelections((prev) => {
      if (prev.some((s) => s.id === sel.id)) return prev.filter((s) => s.id !== sel.id);
      // One pick per market: replace a sibling outcome on the same market.
      const marketScope = sel.id.split("|").slice(0, -1).join("|");
      const next = prev.filter(
        (s) => s.id.split("|").slice(0, -1).join("|") !== marketScope,
      );
      return [...next, sel];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setSelections((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const clear = useCallback(() => setSelections([]), []);
  const isSelected = useCallback(
    (id: string) => selections.some((s) => s.id === id),
    [selections],
  );

  const value = useMemo(
    () => ({ selections, toggle, remove, clear, isSelected, open, setOpen }),
    [selections, toggle, remove, clear, isSelected, open],
  );
  return <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>;
}

// --- UI -----------------------------------------------------------------------

export function BetSlipTray({
  player,
  onPlayerUpdate,
  onRequireLogin,
}: {
  player: StoredPlayer | null;
  onPlayerUpdate: (p: PlayerRecord) => void;
  onRequireLogin?: () => void;
}) {
  const { selections, remove, clear, open, setOpen } = useBetSlip();
  const [currency, setCurrency] = useState<Currency>("COIN");
  const [stake, setStake] = useState("50");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  useAutoClear(error, setError, 5000);

  const guest = !player;
  const combined = selections.reduce((acc, s) => acc * s.odds, 1);
  const stakeBase = parseStake(stake, currency); // coins or lamports
  const potential = Math.floor(stakeBase * combined);
  const balance =
    currency === "SOL"
      ? (player?.player?.sol_balance ?? 0)
      : (player?.player?.coin_balance ?? 0);
  const enough = stakeBase >= MIN_STAKE[currency] && stakeBase <= balance;

  // Reset the stake field to a sensible default when switching currency.
  function switchCurrency(next: Currency) {
    setCurrency(next);
    setStake(stakePlaceholder[next]);
    setError(null);
  }

  useEffect(() => {
    if (selections.length === 0) setOpen(false);
  }, [selections.length, setOpen]);

  async function place() {
    setPlacing(true);
    setError(null);
    try {
      const res = await authFetch("/api/slips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake: stakeBase,
          currency,
          legs: selections.map((s) => ({
            fixtureId: s.fixtureId,
            marketKey: s.marketKey,
            outcomeName: s.outcomeName,
            outcomeLabel: `${s.matchLabel}: ${s.outcomeLabel}`,
            session: s.session ?? null,
            vt: s.vt ?? null,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Could not place the bet.");
      if (body.player) onPlayerUpdate(body.player as PlayerRecord);
      clear();
      setPlaced(
        `Placed! ${formatAmount(stakeBase, currency)} at ${combined.toFixed(2)} pays ${formatAmount(potential, currency)}. Track it in My Bets.`,
      );
      window.setTimeout(() => setPlaced(null), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place the bet.");
    } finally {
      setPlacing(false);
    }
  }

  if (selections.length === 0 && !placed) return null;

  return (
    <>
      {placed && (
        <div className="slip-bar fade-in" style={{ color: "var(--color-tape-green)" }}>
          {placed}
        </div>
      )}

      {selections.length > 0 && !open && (
        <button className="slip-bar fade-in" onClick={() => setOpen(true)}>
          <span>
            <strong>{selections.length}</strong>{" "}
            {selections.length === 1 ? "selection · single" : "selections · accumulator"}
          </span>
          <span style={{ color: "var(--color-ember-orange)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
            odds {combined.toFixed(2)} <ChevronUp size={14} aria-hidden />
          </span>
        </button>
      )}

      {open && (
        <div className="slip-sheet fade-in" role="dialog" aria-label="Bet slip">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="caption section-label">Bet slip</p>
            <button
              className="pill tab"
              onClick={() => setOpen(false)}
              style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              Close <ChevronDown size={14} aria-hidden />
            </button>
          </div>

          <div style={{ display: "grid", gap: 6, maxHeight: "32dvh", overflowY: "auto" }}>
            {selections.map((s) => (
              <div key={s.id} className="outcome-row" style={{ gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }} className="team">
                    {s.outcomeLabel}
                    {s.session ? " · replay" : ""}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {s.marketLabel} · {s.matchLabel}
                  </span>
                </span>
                <span className="price-num">{s.odds.toFixed(2)}</span>
                <button
                  className="pill tab"
                  aria-label={`Remove ${s.outcomeLabel}`}
                  onClick={() => remove(s.id)}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>

          {/* Stake in coins or devnet SOL */}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`pill tab ${currency === "COIN" ? "active" : ""}`}
              style={{ flex: 1, justifyContent: "center", gap: 5 }}
              onClick={() => switchCurrency("COIN")}
            >
              <Coin size={14} /> Coins
            </button>
            <button
              className={`pill tab ${currency === "SOL" ? "active" : ""}`}
              style={{ flex: 1, justifyContent: "center", gap: 5 }}
              onClick={() => switchCurrency("SOL")}
            >
              <Solana size={14} /> SOL
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              className="input"
              style={{ maxWidth: 130 }}
              inputMode="decimal"
              value={stake}
              onChange={(e) =>
                setStake(
                  currency === "SOL"
                    ? e.target.value.replace(/[^\d.]/g, "")
                    : e.target.value.replace(/[^\d]/g, ""),
                )
              }
              aria-label={`Stake in ${currency === "SOL" ? "SOL" : "coins"}`}
            />
            <span className="muted" style={{ fontSize: 12, flex: 1 }}>
              {currency === "SOL" ? "SOL" : "coins"} · you have{" "}
              <span className="mono">{formatAmount(balance, currency)}</span>
            </span>
          </div>

          {/* Quick-stake chips */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {(currency === "SOL"
              ? ([0.05, 0.1, 0.25, "MAX"] as const)
              : ([25, 50, 100, "MAX"] as const)
            ).map((c) => {
              const isMax = c === "MAX";
              const val = isMax
                ? currency === "SOL"
                  ? balance / 1_000_000_000
                  : balance
                : (c as number);
              return (
                <button
                  key={String(c)}
                  className="pill tab"
                  style={{ justifyContent: "center", height: 40 }}
                  onClick={() => setStake(isMax ? String(val) : String(c))}
                >
                  {isMax ? "MAX" : c}
                </button>
              );
            })}
          </div>

          {/* Potential return */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderRadius: "var(--radius-buttons)",
              background: "rgba(0, 168, 90, 0.08)",
              border: "1.5px solid rgba(0, 168, 90, 0.28)",
            }}
          >
            <span style={{ display: "grid", gap: 2 }}>
              <span className="caption" style={{ color: "#5ff29a" }}>
                Potential return
              </span>
              <span className="muted" style={{ fontSize: 10.5 }}>
                {currency === "SOL"
                  ? "Pays withdrawable SOL"
                  : `Pays ≈ ${formatAmount(coinsToLamports(potential), "SOL")} on a win`}{" "}
                · odds {combined.toFixed(2)}
              </span>
            </span>
            <span
              className="mono"
              style={{ fontWeight: 700, fontSize: 20, color: "var(--color-tape-green)" }}
            >
              {formatAmount(potential, currency)}
            </span>
          </div>

          {guest ? (
            <button className="btn btn-primary" onClick={() => onRequireLogin?.()}>
              Join to place this bet
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={placing || !enough}
              onClick={place}
            >
              {placing
                ? "Placing..."
                : stakeBase > balance
                  ? currency === "SOL"
                    ? "Not enough SOL"
                    : "Not enough coins"
                  : `Place call · ${formatAmount(stakeBase, currency)}`}
            </button>
          )}
          <p className="caption muted" style={{ textAlign: "center" }}>
            {guest
              ? "Your picks are saved — join free to place them."
              : currency === "SOL"
                ? "SOL calls pay withdrawable SOL and can be cashed out early."
                : "Coin calls ride to full time and pay out in SOL when they win (no cash out)."}
          </p>
          {!guest && currency === "SOL" && balance < MIN_STAKE.SOL && (
            <p className="caption muted" style={{ textAlign: "center" }}>
              Deposit test SOL in the Wallet tab to bet with SOL.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </>
  );
}
