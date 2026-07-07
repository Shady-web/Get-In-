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
import type { PlayerRecord, StoredPlayer } from "@/lib/player";
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
}: {
  player: StoredPlayer;
  onPlayerUpdate: (p: PlayerRecord) => void;
}) {
  const { selections, remove, clear, open, setOpen } = useBetSlip();
  const [stake, setStake] = useState("50");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  const combined = selections.reduce((acc, s) => acc * s.odds, 1);
  const stakeNum = Math.floor(Number(stake) || 0);
  const potential = Math.floor(stakeNum * combined);
  const coins = player.player?.coin_balance ?? 0;

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
          stake: stakeNum,
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
        `Placed! ${stakeNum} coins at ${combined.toFixed(2)} pays ${potential}. Track it in the My Bets tab.`,
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
          <span style={{ color: "var(--color-ember-orange)", fontWeight: 600 }}>
            odds {combined.toFixed(2)} ▴
          </span>
        </button>
      )}

      {open && (
        <div className="slip-sheet fade-in" role="dialog" aria-label="Bet slip">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="caption section-label">Bet slip</p>
            <button className="pill tab" onClick={() => setOpen(false)}>
              Close ▾
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
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              className="input"
              style={{ maxWidth: 120 }}
              inputMode="numeric"
              value={stake}
              onChange={(e) => setStake(e.target.value.replace(/[^\d]/g, ""))}
              aria-label="Stake in coins"
            />
            <span className="muted" style={{ fontSize: 12, flex: 1 }}>
              coins · you have {coins.toLocaleString()}
            </span>
            <span style={{ textAlign: "right", display: "grid", gap: 1 }}>
              <span className="muted" style={{ fontSize: 11 }}>
                odds {combined.toFixed(2)}
              </span>
              <span style={{ fontWeight: 700, color: "var(--color-ember-orange)" }}>
                pays {potential.toLocaleString()}
              </span>
            </span>
          </div>

          <button
            className="btn btn-primary"
            disabled={placing || stakeNum < 10 || stakeNum > coins}
            onClick={place}
          >
            {placing
              ? "Placing..."
              : stakeNum > coins
                ? "Not enough coins"
                : `Place bet · ${stakeNum} coins`}
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </>
  );
}
