"use client";

// Markets tab: every market TxLINE prices for this fixture, ticking live.
// Prices flash green/red (with a direction glyph) on drift and each outcome
// keeps a small sparkline of its last 20 prices, trading-terminal style.

import { useCallback, useEffect, useRef, useState } from "react";
import { LineChart, Line, YAxis } from "recharts";
import { useBetSlip } from "@/components/bet-slip";
import type { Market } from "@/lib/markets";

const POLL_MS = 7_000;
const HISTORY_LEN = 20;

interface FixtureNames {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
}

function outcomeLabel(name: string, fixture: FixtureNames): string {
  switch (name.toLowerCase()) {
    case "part1":
    case "1":
    case "home":
      return fixture.Participant1;
    case "part2":
    case "2":
    case "away":
      return fixture.Participant2;
    case "x":
    case "draw":
      return "Draw";
    case "over":
      return "Over";
    case "under":
      return "Under";
    default:
      return name;
  }
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <span className="spark-empty" aria-hidden />;
  }
  const data = points.map((v, i) => ({ i, v }));
  return (
    <LineChart
      width={64}
      height={22}
      data={data}
      margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
      aria-label={`Price history: ${points[0]} to ${points[points.length - 1]}`}
    >
      <YAxis domain={["dataMin", "dataMax"]} hide />
      <Line
        type="monotone"
        dataKey="v"
        stroke="#868f97"
        strokeWidth={2}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

export function MarketsPanel({ fixture }: { fixture: FixtureNames }) {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toggle, isSelected } = useBetSlip();
  // Per-outcome price history + last flash direction, kept across polls.
  const historyRef = useRef<Map<string, number[]>>(new Map());
  const flashRef = useRef<Map<string, "up" | "down">>(new Map());

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/markets/${fixture.FixtureId}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error ?? "Markets unavailable.");
      const next = (body.markets ?? []) as Market[];

      for (const m of next) {
        for (const o of m.outcomes) {
          const id = `${m.key}|${o.name}`;
          const hist = historyRef.current.get(id) ?? [];
          const prev = hist[hist.length - 1];
          if (prev !== undefined && o.price !== prev) {
            flashRef.current.set(id, o.price > prev ? "up" : "down");
          }
          if (prev !== o.price || hist.length === 0) {
            hist.push(o.price);
            if (hist.length > HISTORY_LEN) hist.shift();
            historyRef.current.set(id, hist);
          }
        }
      }
      setMarkets(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Markets unavailable.");
    }
  }, [fixture.FixtureId]);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  return (
    <div className="card fade-in" style={{ display: "grid", gap: 16, alignSelf: "start" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="caption section-label">Markets</p>
        {markets && markets.length > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {markets.length} open · ticks every 7s
          </span>
        )}
      </div>

      {!markets && !error && (
        <>
          <div className="skeleton" style={{ height: 56 }} />
          <div className="skeleton" style={{ height: 56, opacity: 0.7 }} />
          <div className="skeleton" style={{ height: 56, opacity: 0.4 }} />
        </>
      )}

      {error && <p className="error-text">{error}</p>}

      {markets && markets.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          No markets priced yet. Books usually open closer to kickoff, so
          check back nearer the match.
        </p>
      )}

      {markets?.map((m) => (
        <section key={m.key} style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.742px" }}>
              {m.label}
            </h4>
            <span className="market-chip">{m.periodLabel}</span>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {m.outcomes.map((o) => {
              const id = `${m.key}|${o.name}`;
              const dir = flashRef.current.get(id) ?? null;
              // Only full-time markets are bettable (halves settle mid-match).
              const periodStr = String(m.period ?? "").toLowerCase();
              const bettable =
                periodStr === "" || periodStr === "ft" || periodStr.includes("full");
              const selId = `${fixture.FixtureId}|${m.key}|${o.name}`;
              const selected = bettable && isSelected(selId);
              const Row = (bettable ? "button" : "div") as "button";
              return (
                <Row
                  key={o.name}
                  className={`outcome-row ${bettable ? "bettable" : ""} ${selected ? "selected" : ""}`}
                  onClick={
                    bettable
                      ? () =>
                          toggle({
                            id: selId,
                            fixtureId: fixture.FixtureId,
                            matchLabel: `${fixture.Participant1} vs ${fixture.Participant2}`,
                            marketKey: m.key,
                            marketLabel: m.label,
                            outcomeName: o.name,
                            outcomeLabel: outcomeLabel(o.name, fixture),
                            odds: o.price,
                          })
                      : undefined
                  }
                >
                  <span className="team" style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
                    {selected ? "✓ " : ""}
                    {outcomeLabel(o.name, fixture)}
                  </span>
                  {o.pct !== null && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {o.pct.toFixed(1)}%
                    </span>
                  )}
                  <Sparkline points={historyRef.current.get(id) ?? []} />
                  <span
                    key={`${id}:${o.price}`}
                    className={`price-num ${dir ? `flash-${dir}` : ""}`}
                  >
                    {dir === "up" ? "▲ " : dir === "down" ? "▼ " : ""}
                    {o.price.toFixed(o.price >= 100 ? 0 : 2)}
                  </span>
                </Row>
              );
            })}
          </div>
        </section>
      ))}
      {markets && markets.length > 0 && (
        <p className="muted" style={{ fontSize: 11, textAlign: "center" }}>
          Tap a full-time price to add it to your bet slip
        </p>
      )}
    </div>
  );
}
