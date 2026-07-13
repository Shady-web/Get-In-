// Server-only: synthesize a rich, coherent set of pre-match / in-play markets
// from the match-winner probabilities, so every bettable match always offers
// variety (Double Chance, Draw No Bet, Over/Under, Both Teams To Score,
// Handicap) even before a bookmaker opens a real book.
//
// Everything is derived from ONE joint score distribution: independent Poisson
// goals for each side, with the scoring rates backed out of the 1X2 win split.
// Each market's outcome probabilities are just sums over that score matrix, so
// the whole book is internally consistent (Double Chance = winner sums, etc.).
// The SAME market keys are settled by legOutcome from the final score, so any
// synthesized pick can actually be graded.

import type { Market, MarketOutcome } from "@/lib/markets";

const OVERROUND = 1.06; // ~6% house margin baked into the synthesized prices
const MAX_GOALS = 8; // score matrix cap; P(>8 for one side) is negligible

export interface Prob3 {
  home: number;
  draw: number;
  away: number;
}

/** Normalize a 1X2 probability triple to sum to 1 (guards against junk input). */
function normalize(p: Prob3): Prob3 {
  const s = p.home + p.draw + p.away;
  if (!(s > 0)) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: p.home / s, draw: p.draw / s, away: p.away / s };
}

/**
 * Back out per-side scoring rates (lambda) from the win split. Total goals are
 * lower for drawish matches; supremacy tilts the split toward the favourite.
 */
export function lambdasFromProb(prob: Prob3): { home: number; away: number } {
  const p = normalize(prob);
  const supremacy = p.home - p.away; // -1..1
  const total = Math.min(3.6, Math.max(1.8, 2.2 + (1 - p.draw) * 1.4));
  const home = Math.max(0.15, total / 2 + supremacy * 0.75);
  const away = Math.max(0.15, total / 2 - supremacy * 0.75);
  return { home, away };
}

function poissonPmf(lambda: number, max: number): number[] {
  const pmf: number[] = [];
  let term = Math.exp(-lambda); // k = 0
  let cumulative = 0;
  for (let k = 0; k <= max; k++) {
    pmf.push(term);
    cumulative += term;
    term = (term * lambda) / (k + 1);
  }
  // Fold the remaining tail into the top bucket so probabilities sum to 1.
  pmf[max] += Math.max(0, 1 - cumulative);
  return pmf;
}

/** Joint P(home = i, away = j) as a (max+1) x (max+1) matrix (independent). */
function scoreMatrix(lh: number, la: number, max: number): number[][] {
  const h = poissonPmf(lh, max);
  const a = poissonPmf(la, max);
  return h.map((ph) => a.map((pa) => ph * pa));
}

/** Sum matrix cells for which predicate(homeGoals, awayGoals) holds. */
function probWhere(m: number[][], predicate: (h: number, a: number) => boolean): number {
  let p = 0;
  for (let h = 0; h < m.length; h++) {
    for (let a = 0; a < m[h].length; a++) {
      if (predicate(h, a)) p += m[h][a];
    }
  }
  return p;
}

/** Fair-ish decimal odds from a probability, with the house margin applied. */
function price(p: number): number | null {
  if (!(p > 0.02)) return null; // skip near-impossible outcomes rather than show 40.0
  const odds = 1 / p / OVERROUND;
  return Math.min(29, Math.max(1.03, Math.round(odds * 100) / 100));
}

function outcome(name: string, p: number): MarketOutcome | null {
  const price_ = price(p);
  if (price_ === null) return null;
  return { name, price: price_, pct: Math.round(p * 1000) / 10 };
}

function market(
  key: string,
  superType: string,
  params: string | null,
  label: string,
  outcomes: (MarketOutcome | null)[],
): Market | null {
  const kept = outcomes.filter((o): o is MarketOutcome => o !== null);
  if (kept.length < 2) return null; // a market needs at least two live prices
  return {
    key,
    superType,
    period: null,
    params,
    label,
    periodLabel: "Full time",
    outcomes: kept,
    ts: Date.now(),
    bookmaker: null,
  };
}

/**
 * A synthesized full-time book from the win probabilities. Excludes the
 * match-winner market itself (that has its own always-on quick card + pricing
 * path); everything here is a DIFFERENT market so there is no redundancy.
 */
export function synthesizeMarkets(prob: Prob3): Market[] {
  const { home: lh, away: la } = lambdasFromProb(prob);
  const m = scoreMatrix(lh, la, MAX_GOALS);

  const pHome = probWhere(m, (h, a) => h > a);
  const pDraw = probWhere(m, (h, a) => h === a);
  const pAway = probWhere(m, (h, a) => h < a);

  const out: (Market | null)[] = [];

  // Double Chance
  out.push(
    market("DOUBLE_CHANCE_PARTICIPANT_RESULT||", "DOUBLE_CHANCE_PARTICIPANT_RESULT", null, "Double chance", [
      outcome("1x", pHome + pDraw),
      outcome("12", pHome + pAway),
      outcome("x2", pDraw + pAway),
    ]),
  );

  // Draw No Bet (draw voids; price off the two non-draw outcomes)
  const noDraw = pHome + pAway;
  out.push(
    market("DRAW_NO_BET_PARTICIPANT_RESULT||", "DRAW_NO_BET_PARTICIPANT_RESULT", null, "Draw no bet", [
      outcome("part1", noDraw > 0 ? pHome / noDraw : 0),
      outcome("part2", noDraw > 0 ? pAway / noDraw : 0),
    ]),
  );

  // Over / Under total goals, three lines
  for (const line of [1.5, 2.5, 3.5]) {
    const pOver = probWhere(m, (h, a) => h + a > line);
    out.push(
      market(
        `OVERUNDER_PARTICIPANT_GOALS||line=${line}`,
        "OVERUNDER_PARTICIPANT_GOALS",
        `line=${line}`,
        `Over/Under ${line} goals`,
        [outcome("over", pOver), outcome("under", 1 - pOver)],
      ),
    );
  }

  // Both Teams To Score
  const pBtts = probWhere(m, (h, a) => h >= 1 && a >= 1);
  out.push(
    market("BTTS_PARTICIPANT_GOALS||", "BTTS_PARTICIPANT_GOALS", null, "Both teams to score", [
      outcome("yes", pBtts),
      outcome("no", 1 - pBtts),
    ]),
  );

  // Handicap -1 / +1 on the home side (whole-number lines can push -> void)
  for (const line of [-1, 1]) {
    const pPart1 = probWhere(m, (h, a) => h + line > a);
    const pPush = probWhere(m, (h, a) => h + line === a);
    const pPart2 = probWhere(m, (h, a) => h + line < a);
    const denom = 1 - pPush; // price the two win outcomes off non-push mass
    if (denom <= 0) continue;
    out.push(
      market(
        `ASIANHANDICAP_PARTICIPANT_GOALS||line=${line}`,
        "ASIANHANDICAP_PARTICIPANT_GOALS",
        `line=${line}`,
        `Handicap ${line > 0 ? `+${line}` : line}`,
        [outcome("part1", pPart1 / denom), outcome("part2", pPart2 / denom)],
      ),
    );
  }

  return out.filter((x): x is Market => x !== null);
}
