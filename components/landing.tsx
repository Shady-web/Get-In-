"use client";

// Logged-out landing: a hero that sells the product, then the shared
// how-it-works loop, shown above the live match list. Built entirely from the
// app's existing header/nav (the surrounding shell), tokens and button styles.

import { HowItWorks, HOW_INTRO } from "@/components/how-it-works";

export function Landing({
  onJoin,
  onBrowse,
  showHowItWorks = true,
}: {
  onJoin: () => void;
  onBrowse: () => void;
  /** Hidden once the visitor has dismissed the "How GetIN works" explainer. */
  showHowItWorks?: boolean;
}) {
  return (
    <section className="fade-in" style={{ display: "grid", gap: 22 }}>
      {/* Hero */}
      <div style={{ display: "grid", gap: 14 }}>
        <p className="caption section-label">{HOW_INTRO.eyebrow}</p>
        <h1 className="display" style={{ fontSize: 40, lineHeight: 0.96, margin: 0 }}>
          {HOW_INTRO.headlineTop}
          <br />
          <span style={{ color: "var(--color-lime)" }}>{HOW_INTRO.headlineAccent}</span>
        </h1>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.55, maxWidth: 380 }}>
          {HOW_INTRO.sub}
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <button className="btn btn-primary" onClick={onJoin}>
            Join now
          </button>
          <button className="btn btn-ghost" onClick={onBrowse}>
            Browse matches
          </button>
        </div>
      </div>

      {showHowItWorks && (
        <>
          <HowItWorks />

          {/* Repeat the primary CTA after the loop, where intent is highest. */}
          <button className="btn btn-primary" onClick={onJoin}>
            {HOW_INTRO.cta}
          </button>
        </>
      )}
    </section>
  );
}
