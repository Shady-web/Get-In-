"use client";

// GetIN!!! Pro: the monetization demo screen. Shows what a paid tier would
// unlock (full odds-history charts, market alerts, double daily claim) with
// a MOCK upgrade flow. No payment exists: "upgrading" just flips a local
// flag so judges can see the before/after. Clearly labeled as a demo.

import { useEffect, useState } from "react";

const STORAGE_KEY = "getin.pro";

/** Local demo-Pro flag. Lift this into the screen that owns the header. */
export function useProDemo(): { pro: boolean; setPro: (v: boolean) => void } {
  const [pro, setProState] = useState(false);
  useEffect(() => {
    setProState(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);
  const setPro = (v: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    setProState(v);
  };
  return { pro, setPro };
}

/** Static teaser sparkline (no live data behind the paywall, on purpose). */
function TeaserChart() {
  const points = "0,26 14,22 28,24 42,15 56,18 70,8 84,12 98,4 112,9 126,2";
  return (
    <svg width="100%" height="34" viewBox="0 0 126 34" preserveAspectRatio="none" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-signal-blue)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SAMPLE_ALERTS = [
  { text: "Over 2.5 goals just crossed 2.00", when: "62'" },
  { text: "Ghana drifting: 44% -> 38% in 5 minutes", when: "57'" },
  { text: "Draw price shortening fast across 3 books", when: "51'" },
];

export function ProPanel({
  pro,
  onChange,
}: {
  pro: boolean;
  onChange: (v: boolean) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");

  return (
    <section style={{ display: "grid", gap: "var(--element-gap)" }}>
      {/* Hero */}
      <div className="card fade-in" style={{ display: "grid", gap: 8, textAlign: "center" }}>
        <p className="caption section-label">✨ GetIN!!! Pro</p>
        <h2 className="heading-sm" style={{ fontSize: 24 }}>
          {pro ? (
            <>
              You&apos;re on the <span className="brand-gradient">Pro demo</span>
            </>
          ) : (
            <>
              See what the <span className="brand-gradient">sharps</span> see
            </>
          )}
        </h2>
        <p className="muted" style={{ fontSize: 13 }}>
          {pro
            ? "All Pro previews below are unlocked. This is a hackathon demo: no payment was made and none is wired up."
            : "Deeper market data for serious players. $4.99/month or $39.99/year."}
        </p>
        {pro ? (
          <button className="pill tab" style={{ justifySelf: "center" }} onClick={() => onChange(false)}>
            Turn off demo
          </button>
        ) : (
          <button
            className="btn btn-primary"
            style={{ justifySelf: "center", minWidth: 220 }}
            onClick={() => setSheetOpen(true)}
          >
            Upgrade to Pro
          </button>
        )}
      </div>

      {/* Feature: full odds history */}
      <div className="card fade-in" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Full odds-history charts</p>
          {!pro && <span className="pro-lock">🔒 Pro</span>}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Every price tick from the moment markets open, for every market on
          the board, not just the last 20 points.
        </p>
        <div className={pro ? "" : "pro-teaser"}>
          <TeaserChart />
        </div>
      </div>

      {/* Feature: market alerts */}
      <div className="card fade-in" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Market alerts</p>
          {!pro && <span className="pro-lock">🔒 Pro</span>}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Get pinged when a price crosses your line or a market moves hard.
        </p>
        <div className={`${pro ? "" : "pro-teaser"}`} style={{ display: "grid", gap: 6 }}>
          {SAMPLE_ALERTS.map((a) => (
            <div key={a.text} className="outcome-row" style={{ gap: 8 }}>
              <span style={{ fontSize: 12.5, flex: 1 }}>🔔 {a.text}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {a.when}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Feature: double claim */}
      <div className="card fade-in" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>Double daily claim</p>
          {!pro && <span className="pro-lock">🔒 Pro</span>}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          1,000 coins a day instead of 500, so a cold streak never locks you
          out of the action.
        </p>
      </div>

      <p className="caption muted" style={{ textAlign: "center" }}>
        Demo only: this screen shows the monetization path. No payments are
        wired up in the hackathon build.
      </p>

      {/* Mock checkout sheet */}
      {sheetOpen && (
        <div className="slip-sheet fade-in" role="dialog" aria-label="Upgrade to Pro">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="caption section-label">✨ Upgrade to Pro</p>
            <button className="pill tab" onClick={() => setSheetOpen(false)}>
              Close ▾
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(
              [
                ["monthly", "$4.99 / month"],
                ["yearly", "$39.99 / year · save 33%"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`outcome-row bettable ${plan === key ? "selected" : ""}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setPlan(key)}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {plan === key ? "✓ " : ""}
                  {label}
                </span>
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              onChange(true);
              setSheetOpen(false);
            }}
          >
            Start demo upgrade (no payment)
          </button>
          <p className="caption muted" style={{ textAlign: "center" }}>
            Nothing is charged: this only flips a local demo flag.
          </p>
        </div>
      )}
    </section>
  );
}
