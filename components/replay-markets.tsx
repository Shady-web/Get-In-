"use client";

// Full market set inside a replay, synthesized from the win probabilities at
// the current scrub position (the same model live matches use). Bets carry the
// replay session + virtual time, so they price and settle from the replay
// exactly like a live bet. Odds move as the replay clock advances.

import { useMemo } from "react";
import { Check } from "lucide-react";
import { synthesizeMarkets } from "@/lib/market-model";
import { winnerOdds } from "@/lib/odds";
import { useBetSlip } from "@/components/bet-slip";
import type { LiveState } from "@/lib/live";

function outcomeLabel(name: string, home: string, away: string): string {
  switch (name.toLowerCase()) {
    case "part1": case "1": case "home": return home;
    case "part2": case "2": case "away": return away;
    case "x": case "draw": return "Draw";
    case "over": return "Over";
    case "under": return "Under";
    case "yes": return "Yes";
    case "no": return "No";
    case "1x": return `${home} or Draw`;
    case "12": return `${home} or ${away}`;
    case "x2": return `Draw or ${away}`;
    default: return name;
  }
}

export function ReplayMarkets({
  fixture,
  state,
  session,
  vt,
}: {
  fixture: { FixtureId: number; Participant1: string; Participant2: string };
  state: LiveState;
  session: string;
  vt: number;
}) {
  const { toggle, isSelected } = useBetSlip();

  const prob = useMemo(() => {
    if (state.prob) return state.prob;
    const o = winnerOdds(state);
    return { home: 1 / o.home, draw: 1 / o.draw, away: 1 / o.away };
  }, [state.prob, state.odds]);

  const markets = useMemo(
    () => synthesizeMarkets(prob),
    [prob.home, prob.draw, prob.away],
  );

  if (markets.length === 0) return null;
  const floorVt = Math.floor(vt);

  return (
    <div className="card fade-in" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="caption section-label">More markets</p>
        <span className="muted" style={{ fontSize: 11 }}>
          {markets.length} · odds move with the replay
        </span>
      </div>

      {markets.map((m) => (
        <section key={m.key} style={{ display: "grid", gap: 6 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.742px" }}>{m.label}</h4>
          <div style={{ display: "grid", gap: 4 }}>
            {m.outcomes.map((o) => {
              const selId = `${session}|${m.key}|${o.name}`;
              const selected = isSelected(selId);
              return (
                <button
                  key={o.name}
                  className={`outcome-row bettable ${selected ? "selected" : ""}`}
                  onClick={() =>
                    toggle({
                      id: selId,
                      fixtureId: fixture.FixtureId,
                      matchLabel: `${fixture.Participant1} vs ${fixture.Participant2}`,
                      marketKey: m.key,
                      marketLabel: m.label,
                      outcomeName: o.name,
                      outcomeLabel: outcomeLabel(o.name, fixture.Participant1, fixture.Participant2),
                      odds: o.price,
                      session,
                      vt: floorVt,
                    })
                  }
                >
                  <span className="team" style={{ flex: 1, minWidth: 0, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {selected && <Check size={13} aria-hidden style={{ color: "var(--color-lime)", flex: "none" }} />}
                    {outcomeLabel(o.name, fixture.Participant1, fixture.Participant2)}
                  </span>
                  <span className="price-num">{o.price.toFixed(2)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="muted" style={{ fontSize: 11, textAlign: "center" }}>
        Tap a price to add it to your bet slip. It settles at the replay's full time.
      </p>
    </div>
  );
}
