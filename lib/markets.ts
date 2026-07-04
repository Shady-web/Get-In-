// Server-only: normalize a raw TxLINE odds snapshot into a market list for
// the Markets tab. Markets are keyed by the REAL payload identifiers
// (SuperOddsType, MarketPeriod, MarketParameters) as captured in
// sample-odds.json; labels are display-only prettification of those keys.

import { getOddsSnapshot } from "@/lib/odds-snapshot";

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
  if (superType === "OVERUNDER_PARTICIPANT_GOALS") {
    return line ? `Over/Under ${line} goals` : "Over/Under goals";
  }
  if (superType === "ASIANHANDICAP_PARTICIPANT_GOALS") {
    return line ? `Asian handicap ${line}` : "Asian handicap";
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

/** Sort: match winner first, then over/under, then handicap; FT before halves. */
function marketOrder(m: Market): [number, number, number] {
  const family =
    m.superType === "1X2_PARTICIPANT_RESULT"
      ? 0
      : m.superType === "OVERUNDER_PARTICIPANT_GOALS"
        ? 1
        : m.superType === "ASIANHANDICAP_PARTICIPANT_GOALS"
          ? 2
          : 3;
  const period = m.period === null || m.period === "" ? 0 : 1;
  const line = Number(/line=([-\d.]+)/.exec(m.params ?? "")?.[1] ?? 0);
  return [period, family, line];
}

export async function getMarkets(fixtureId: number): Promise<Market[]> {
  const raw = await getOddsSnapshot(fixtureId);
  if (!Array.isArray(raw)) return [];

  // Latest payload per real market key wins.
  const latest = new Map<string, any>();
  for (const entry of raw) {
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

  markets.sort((a, b) => {
    const [ap, af, al] = marketOrder(a);
    const [bp, bf, bl] = marketOrder(b);
    return ap - bp || af - bf || al - bl;
  });
  return markets;
}
