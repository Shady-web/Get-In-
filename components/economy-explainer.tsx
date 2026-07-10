"use client";

// "How GetIN works" — the economy explainer. Opens automatically on a
// player's first visit and on demand from the coin pill in the header.
// Documents GI coins, test SOL, and the cash-out rule (coin calls ride to
// settlement; SOL calls can be cashed out).

import { useEffect, useState } from "react";

const SEEN_KEY = "getin.economySeen";

/** Controls first-visit auto-open; the header button can force it too. */
export function useEconomyExplainer() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(SEEN_KEY)) {
        const id = window.setTimeout(() => setOpen(true), 700);
        return () => window.clearTimeout(id);
      }
    } catch {
      /* ignore */
    }
  }, []);
  function close() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }
  return { open, openExplainer: () => setOpen(true), close };
}

const STEPS: [string, string][] = [
  ["🎯", "Quests + wins"],
  ["🪙", "Earn GI coins"],
  ["⚡", "Stake a market"],
  ["🏆", "Win"],
  ["◎", "SOL payout"],
  ["⭐", "Climb leaders"],
];

function Bullet({
  icon,
  color,
  title,
  body,
}: {
  icon: string;
  color: string;
  title: string;
  body: string;
}) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
      <span
        style={{
          width: 32,
          height: 32,
          flex: "none",
          borderRadius: 9,
          background: `${color}22`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
        }}
      >
        {icon}
      </span>
      <div>
        <p
          className="caption"
          style={{ color: "var(--color-snow)", fontWeight: 800, marginBottom: 2 }}
        >
          {title}
        </p>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {body}
        </p>
      </div>
    </div>
  );
}

export function EconomyExplainer({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" role="dialog" aria-label="How GetIN works" onClick={onClose}>
      <div className="modal-sheet fade-in" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <p className="caption section-label" style={{ color: "#5ff29a" }}>
              The economy
            </p>
            <h2 className="display" style={{ fontSize: 28, marginTop: 3 }}>
              How GetIN works
            </h2>
          </div>
          <button className="pill tab" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* flow diagram */}
        <div
          className="gi-scroll"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 2,
            overflowX: "auto",
            padding: "14px 0",
            margin: "4px 0",
            borderTop: "1px solid var(--color-border)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {STEPS.map(([icon, label], i) => (
            <div key={label} style={{ display: "flex", alignItems: "flex-start" }}>
              <div
                style={{
                  flex: "none",
                  width: 70,
                  display: "grid",
                  gap: 6,
                  justifyItems: "center",
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: "var(--surface-elevated-card)",
                    border: "1.5px solid var(--color-slate)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 19,
                  }}
                >
                  {icon}
                </span>
                <span
                  className="caption"
                  style={{ fontSize: 9, color: "var(--color-ash)", letterSpacing: "0.02em" }}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span style={{ color: "var(--color-fog)", marginTop: 12 }}>›</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gap: 14, marginTop: 4 }}>
          <Bullet
            icon="🪙"
            color="#FFC530"
            title="GI Coins"
            body="Your free play-money balance. Earn them from daily quests, winning calls and correct picks. Stake them on any market - coin calls pay out more coins and ride to full time (they settle automatically, no early cash out)."
          />
          <Bullet
            icon="◎"
            color="#5ff29a"
            title="Test SOL"
            body="Real devnet tokens you deposit from the faucet (no real value). Stake SOL too - SOL calls pay out withdrawable SOL, and you can cash a SOL call out early before it settles."
          />
          <Bullet
            icon="🔒"
            color="#FFC530"
            title="Cash out"
            body="Only SOL calls can be cashed out early. Coin calls always run to the final whistle."
          />
        </div>

        <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 4 }}>
          Got it
        </button>
      </div>
    </div>
  );
}
