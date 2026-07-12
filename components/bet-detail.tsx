"use client";

// Bet-slip "ticket details": tap a slip in My Bets to see the full breakdown -
// per leg the match, full-time (or live) score, market, pick + odds and
// whether it won/lost, plus ticket-level stake, odds and return.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { authFetch } from "@/lib/api-client";
import { coinsToLamports, formatAmount, type Currency } from "@/lib/money";
import { ResultIcon } from "@/components/icons";

interface DetailLeg {
  id: string;
  matchLabel: string;
  pick: string;
  marketLabel: string;
  odds: number;
  result: string;
  session: boolean;
  score: { home: number; away: number; final: boolean } | null;
}

interface DetailSlip {
  id: string;
  stake: number;
  combined_odds: number;
  potential_return: number;
  cashout_amount: number | null;
  status: string;
  currency: Currency;
  placed_at: string | null;
  settled_at: string | null;
  legs: DetailLeg[];
}

const statusColor = (s: string) =>
  s === "won"
    ? "var(--color-tape-green)"
    : s === "lost"
      ? "var(--color-festival-red)"
      : s === "cashed"
        ? "var(--color-ember-orange)"
        : s === "void"
          ? "var(--color-fog)"
          : "var(--color-snow)";

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span className="muted" style={{ fontSize: 13 }}>
        {k}
      </span>
      <span
        className="mono"
        style={{ fontSize: strong ? 18 : 14, fontWeight: strong ? 700 : 600, textAlign: "right" }}
      >
        {v}
      </span>
    </div>
  );
}

export function BetSlipDetail({ slipId, onClose }: { slipId: string; onClose: () => void }) {
  const [slip, setSlip] = useState<DetailSlip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/slips/${slipId}`);
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body?.error ?? "Could not load the ticket.");
        if (!cancelled) setSlip(body.slip as DetailSlip);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the ticket.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slipId]);

  const ccy: Currency = slip?.currency === "SOL" ? "SOL" : "COIN";
  const statusLabel =
    slip?.status === "pending" ? "Open" : (slip?.status ?? "").toUpperCase();

  // Return: won pays out (coins pay in SOL), cashed pays the cash-out, void
  // refunds the stake, lost / open return nothing settled.
  let returnText = "—";
  if (slip) {
    if (slip.status === "won") {
      const amt =
        ccy === "COIN" ? coinsToLamports(slip.potential_return) : slip.potential_return;
      returnText = `+${formatAmount(amt, "SOL")}`;
    } else if (slip.status === "cashed") {
      returnText = `+${formatAmount(Number(slip.cashout_amount ?? 0), ccy)}`;
    } else if (slip.status === "void") {
      returnText = formatAmount(slip.stake, ccy);
    } else if (slip.status === "lost") {
      returnText = formatAmount(0, ccy);
    } else {
      returnText = `${formatAmount(slip.potential_return, ccy)} (potential)`;
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-label="Ticket details" onClick={onClose}>
      <div className="modal-sheet fade-in" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div>
            <p className="caption section-label" style={{ color: "#5ff29a" }}>
              Ticket details
            </p>
            <p style={{ fontSize: 17, fontWeight: 800, marginTop: 3 }}>
              {slip ? (slip.legs.length > 1 ? "Accumulator" : "Single") : "Ticket"}
              {slip && (
                <span style={{ color: statusColor(slip.status), marginLeft: 8 }}>· {statusLabel}</span>
              )}
            </p>
          </div>
          <button className="pill tab" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}
        {!slip && !error && (
          <>
            <div className="skeleton" style={{ height: 90 }} />
            <div className="skeleton" style={{ height: 120, opacity: 0.6 }} />
          </>
        )}

        {slip && (
          <>
            <div
              style={{
                display: "grid",
                gap: 8,
                padding: "12px 14px",
                borderRadius: "var(--radius-buttons)",
                background: "var(--surface-elevated-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <Row
                k="Return"
                strong
                v={returnText}
              />
              <Row k="Stake" v={formatAmount(slip.stake, ccy)} />
              <Row k="Total odds" v={Number(slip.combined_odds).toFixed(2)} />
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {slip.legs.map((l) => (
                <div
                  key={l.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "12px 4px",
                    borderTop: "1px solid var(--color-border)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flex: "none",
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 800,
                      color: "var(--color-void)",
                      background: statusColor(l.result),
                    }}
                  >
                    <ResultIcon result={l.result} size={13} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 5 }}>
                    <p style={{ fontSize: 14, fontWeight: 700 }} className="team">
                      {l.matchLabel || l.pick}
                      {l.session ? "  · replay" : ""}
                    </p>
                    <p className="caption muted" style={{ letterSpacing: 0 }}>
                      {l.score
                        ? `${l.score.final ? "FT" : "LIVE"} ${l.score.home}:${l.score.away}`
                        : "Score unavailable"}
                    </p>
                    <div
                      style={{
                        display: "grid",
                        gap: 3,
                        padding: "8px 10px",
                        borderRadius: 10,
                        background: "var(--surface-card)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          Pick
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>
                          {l.pick} <span className="mono">@ {l.odds.toFixed(2)}</span>
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          Market
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>
                          {l.marketLabel}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          Outcome
                        </span>
                        <span
                          style={{ fontSize: 12.5, fontWeight: 700, textAlign: "right", color: statusColor(l.result) }}
                        >
                          {l.result === "pending" ? "In play" : l.result.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
