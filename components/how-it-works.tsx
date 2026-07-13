"use client";

// Single source of the "How GetIN works" copy — the loop, the business model,
// and the devnet disclaimer. Rendered both by the logged-out landing and the
// "How GetIN works" modal, so the two never drift. Uses the app's existing
// tokens/classes (lime accent, glass cards, Anton/Space Mono/Archivo fonts).

import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Coins,
  Droplet,
  LogIn,
  Percent,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";

export interface HowStep {
  icon: LucideIcon;
  title: string;
  body: string;
  live?: boolean; // stake step carries a LIVE badge
  gold?: boolean; // final "convert & withdraw" step is gold
}

/** Landing hero copy (kept here so the landing and modal share one source). */
export const HOW_INTRO = {
  eyebrow: "How it works",
  headlineTop: "Zero to staked",
  headlineAccent: "in seconds.",
  sub: "GetIN runs on Solana devnet — no cost, no risk. Play the World Cup with real odds and a test-money economy that mirrors the real thing.",
  cta: "Join now — claim test SOL",
} as const;

/** The player loop: login → auto wallet → claim → stake → cash out → convert. */
export const HOW_STEPS: HowStep[] = [
  { icon: LogIn, title: "Log in", body: "One tap to sign in. No seed phrase, no setup, no wallet app to install." },
  {
    icon: Wallet,
    title: "Get a wallet — automatically",
    body: "A Solana devnet wallet is spun up for you in the background the moment you're in.",
  },
  {
    icon: Droplet,
    title: "Claim test SOL",
    body: "Draw free test SOL from the house pool to start playing right away.",
  },
  {
    icon: Zap,
    title: "Stake on live odds",
    body: "Back outcomes on World Cup fixtures at real-time odds that move with the match.",
    live: true,
  },
  {
    icon: TrendingUp,
    title: "Cash out or settle",
    body: "Take profit early while odds are hot, or let your pick settle at the final whistle.",
  },
  {
    icon: ArrowLeftRight,
    title: "Convert & withdraw",
    body: "Turn your coin winnings into withdrawable SOL. The loop closes — and pays out.",
    gold: true,
  },
];

/** One line on how the house earns: odds margin + coin economy. */
export const HOW_MODEL = {
  title: "How GetIN earns",
  line: "GetIN makes money the way every book does — a small margin baked into the odds — plus the coin economy of buy-ins, boosts and conversion fees on the way back to withdrawable SOL.",
  points: [
    {
      icon: Percent,
      title: "House margin on odds",
      body: "A small edge is baked into every odds line — the same vig that runs every book.",
    },
    {
      icon: Coins,
      title: "Coin economy",
      body: "Buy-ins, boosts and conversion fees on the way from coins back to withdrawable SOL.",
    },
  ],
};

export const HOW_DISCLAIMER =
  "Devnet · test tokens · no real value. GetIN is a free-to-play World Cup prediction game on Solana devnet — nothing here is real money.";

function StepRow({ step, index, last }: { step: HowStep; index: number; last: boolean }) {
  const Icon = step.icon;
  const badgeStyle: React.CSSProperties = step.gold
    ? { background: "var(--color-gold)", color: "var(--color-void)", border: "none" }
    : index === 0
      ? { background: "var(--color-lime)", color: "var(--color-void)", border: "none" }
      : {
          background: "rgba(190, 255, 80, 0.14)",
          color: "var(--color-lime)",
          border: "1.5px solid var(--color-lime)",
        };
  const accent = step.gold ? "var(--color-gold)" : "var(--color-lime)";
  return (
    <div style={{ display: "flex", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span
          className="mono"
          style={{
            width: 30,
            height: 30,
            flex: "none",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            ...badgeStyle,
          }}
        >
          {index + 1}
        </span>
        {!last && <span style={{ width: 1.5, flex: 1, background: "var(--color-border)", margin: "6px 0" }} />}
      </div>
      <div
        className="card"
        style={{
          flex: 1,
          minWidth: 0,
          padding: "14px 16px",
          marginBottom: last ? 0 : 12,
          border: step.gold ? "1px solid rgba(255, 197, 48, 0.28)" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
          <Icon size={18} aria-hidden style={{ color: accent, flex: "none" }} />
          <span style={{ fontSize: 15.5, fontWeight: 700, color: "var(--color-snow)" }}>{step.title}</span>
          {step.live && (
            <span
              className="caption mono"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--color-tape-green)",
                background: "rgba(60, 232, 138, 0.12)",
              }}
            >
              <span className="live-dot" style={{ width: 6, height: 6 }} /> LIVE
            </span>
          )}
        </div>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          {step.body}
        </p>
      </div>
    </div>
  );
}

/**
 * The shared how-it-works body: the loop, the model card, and the devnet
 * disclaimer. `intro` optionally prepends the one-line intro paragraph (the
 * modal uses it for context; the landing shows its own hero above instead).
 */
export function HowItWorks({ intro = false }: { intro?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      {intro && (
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>
          {HOW_INTRO.sub}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {HOW_STEPS.map((step, i) => (
          <StepRow key={step.title} step={step} index={i} last={i === HOW_STEPS.length - 1} />
        ))}
      </div>

      <section style={{ display: "grid", gap: 12 }}>
        <p className="caption section-label">The model</p>
        <div
          className="card"
          style={{
            padding: 18,
            border: "1px solid rgba(190, 255, 80, 0.22)",
            display: "grid",
            gap: 12,
          }}
        >
          <h3 className="display" style={{ fontSize: 22 }}>
            {HOW_MODEL.title}
          </h3>
          {HOW_MODEL.points.map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={p.title}>
                {i > 0 && <div style={{ height: 1, background: "var(--color-border)", margin: "0 0 12px" }} />}
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <Icon size={18} aria-hidden style={{ color: "var(--color-lime)", marginTop: 2, flex: "none" }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--color-snow)", marginBottom: 2 }}>
                      {p.title}
                    </div>
                    <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                      {p.body}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="caption muted" style={{ fontSize: 11.5, lineHeight: 1.6, letterSpacing: 0 }}>
        {HOW_DISCLAIMER}
      </p>
    </div>
  );
}
