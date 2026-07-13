// Server-only: normalize a raw TxLINE odds snapshot into a market list for
// the Markets tab. Markets are keyed by the REAL payload identifiers
// (SuperOddsType, MarketPeriod, MarketParameters) as captured in
// sample-odds.json; labels are display-only prettification of those keys.

import { getOddsSnapshot } from "@/lib/odds-snapshot";
import { getLiveState } from "@/lib/live";
import { isFinal } from "@/lib/game-core";
import { winnerOdds } from "@/lib/odds";
import { synthesizeMarkets, type Prob3 } from "@/lib/market-model";

export interface MarketOutcome {
  name: string; // raw PriceName: part1/draw/part2/over/under/...
  price: number; // decimal odds
  pct: number | null; // implied percentage as sent by TxLINE
}

export interface Market {
  key: string; // "SuperOddsType|MarketPeriod|MarketParameters"
  superType: string; // raw SuperOddsType
  period: string | null; // raw MarketPeriod (null = full time)
  params: string | null; // raw MarketParameters (e.g. "line=2.5")
  label: string; // display label derived from the raw keys
  periodLabel: string; // "Full time" / "1st half" / raw
  outcomes: MarketOutcome[];
  ts: number;
  bookmaker: string | null;
}

function marketLabel(superType: string, params: string | null): string {
  const line = /line=([-\d.]+)/.exec(params ?? "")?.[1];
  if (superType === "1X2_PARTICIPANT_RESULT") return "Match winner";
  if (superType === "DOUBLE_CHANCE_PARTICIPANT_RESULT") return "Double chance";
  if (superType === "DRAW_NO_BET_PARTICIPANT_RESULT") return "Draw no bet";
  if (superType === "BTTS_PARTICIPANT_GOALS") return "Both teams to score";
  if (superType === "OVERUNDER_PARTICIPANT_GOALS") {
    return line ? `Over/Under ${line} goals` : "Over/Under goals";
  }
  if (superType === "ASIANHANDICAP_PARTICIPANT_GOALS") {
    if (!line) return "Handicap";
    return `Handicap ${Number(line) > 0 ? `+${line}` : line}`;
  }
  // Unknown market type: prettify the raw key, never invent semantics.
  const pretty = superType
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return line ? `${pretty} ${line}` : pretty;
}

function periodLabel(period: string | null): string {
  const p = String(period ?? "").toLowerCase();
  if (p === "" || p === "null" || p === "ft" || p.includes("full")) return "Full time";
  if (p === "half=1") return "1st half";
  if (p === "half=2") return "2nd half";
  if (p === "penalties") return "Penalties";
  return String(period);
}

function decimalPrice(priceRaw: unknown, pct: number | null): number | null {
  const p = Number(priceRaw);
  if (Number.isFinite(p) && p >= 1000 && p <= 1_000_000) return Math.round(p) / 1000;
  if (pct && pct > 0) return Math.round((100 / pct) * 100) / 100;
  return null;
}

/** Family sort order, most-popular markets first; FT before halves. */
const FAMILY_ORDER: Record<string, number> = {
  "1X2_PARTICIPANT_RESULT": 0,
  "DOUBLE_CHANCE_PARTICIPANT_RESULT": 1,
  "DRAW_NO_BET_PARTICIPANT_RESULT": 2,
  "OVERUNDER_PARTICIPANT_GOALS": 3,
  "BTTS_PARTICIPANT_GOALS": 4,
  "ASIANHANDICAP_PARTICIPANT_GOALS": 5,
};
function marketOrder(m: Market): [number, number, number] {
  const family = FAMILY_ORDER[m.superType] ?? 9;
  const period = m.period === null || m.period === "" ? 0 : 1;
  const line = Number(/line=([-\d.]+)/.exec(m.params ?? "")?.[1] ?? 0);
  return [period, family, line];
}

/** The win-probability triple to synthesize the rest of the book from. Prefer
 *  the real 1X2 market if the feed priced one (so the synthesized markets agree
 *  with the shown winner odds), else live prob, else the indicative winner. */
function synthProb(winner: Market | undefined, live: { prob?: Prob3 | null; odds?: any } | null): Prob3 {
  if (winner) {
    const by = (n: string) => winner.outcomes.find((o) => o.name === n);
    const imp = (o: MarketOutcome | undefined) =>
      o ? (o.pct && o.pct > 0 ? o.pct : 100 / o.price) : 0;
    const home = imp(by("part1") ?? by("1") ?? by("home"));
    const draw = imp(by("draw") ?? by("x"));
    const away = imp(by("part2") ?? by("2") ?? by("away"));
    if (home > 0 && away > 0) return { home, draw, away };
  }
  if (live?.prob) return live.prob;
  const o = winnerOdds(live ?? {});
  return { home: 1 / o.home, draw: 1 / o.draw, away: 1 / o.away };
}

export async function getMarkets(fixtureId: number): Promise<Market[]> {
  // Real book + live state in parallel; a flaky odds feed must still leave a
  // synthesized book behind (that's what makes pre-match odds always present).
  const [raw, live] = await Promise.all([
    getOddsSnapshot(fixtureId),
    getLiveState(fixtureId).catch(() => null),
  ]);
  const rawArr = Array.isArray(raw) ? raw : [];

  // Latest payload per real market key wins.
  const latest = new Map<string, any>();
  for (const entry of rawArr) {
    const p = (entry as any)?.data ?? entry;
    if (!p || !Array.isArray(p.PriceNames) || !Array.isArray(p.Prices)) continue;
    const key = `${p.SuperOddsType ?? ""}|${p.MarketPeriod ?? ""}|${p.MarketParameters ?? ""}`;
    const prev = latest.get(key);
    if (!prev || (p.Ts ?? 0) >= (prev.Ts ?? 0)) latest.set(key, p);
  }

  const markets: Market[] = [];
  for (const [key, p] of latest) {
    const outcomes: MarketOutcome[] = [];
    p.PriceNames.forEach((name: unknown, i: number) => {
      const pct = Array.isArray(p.Pct) ? Number.parseFloat(String(p.Pct[i])) : NaN;
      const pctVal = Number.isFinite(pct) ? pct : null;
      const price = decimalPrice(p.Prices[i], pctVal);
      if (price !== null) {
        outcomes.push({ name: String(name), price, pct: pctVal });
      }
    });
    if (outcomes.length === 0) continue;
    markets.push({
      key,
      superType: String(p.SuperOddsType ?? ""),
      period: p.MarketPeriod ?? null,
      params: p.MarketParameters ?? null,
      label: marketLabel(String(p.SuperOddsType ?? ""), p.MarketParameters ?? null),
      periodLabel: periodLabel(p.MarketPeriod ?? null),
      outcomes,
      ts: Number(p.Ts ?? 0),
      bookmaker: p.Bookmaker ?? null,
    });
  }

  // Enrich with a synthesized book so every non-finished match always offers
  // a variety of markets, even before a real bookmaker opens one. Real feed
  // markets take priority; synthesized markets only fill families the feed is
  // missing, so there's no double pricing of the same market.
  const finished = live ? isFinal(live.statusId) : false;
  if (!finished) {
    const present = new Set(markets.map((m) => m.key));
    const winner = markets.find((m) => m.superType.toUpperCase().includes("1X2"));
    for (const m of synthesizeMarkets(synthProb(winner, live))) {
      if (!present.has(m.key)) markets.push(m);
    }
  }

  markets.sort((a, b) => {
    const [ap, af, al] = marketOrder(a);
    const [bp, bf, bl] = marketOrder(b);
    return ap - bp || af - bf || al - bl;
  });
  return markets;
}
