// Client-safe winner-odds helper. Every non-finished match should always be
// bettable on the Match Winner market, even before a bookmaker opens a book:
// use the real 1X2 odds when the feed has them, else derive prices from the
// win-probability split, else fall back to a flat default. Display and
// server-side placement both call this so the numbers agree.

export interface WinnerOdds {
  home: number;
  draw: number;
  away: number;
}

// Flat prices for a match with no market and no probabilities yet.
const DEFAULT_WINNER: WinnerOdds = { home: 2.5, draw: 3.2, away: 2.8 };

export function winnerOdds(src: {
  odds?: WinnerOdds | null;
  prob?: { home: number; draw: number; away: number } | null;
}): WinnerOdds {
  if (src.odds) return src.odds;
  if (src.prob) {
    const fromPct = (p: number) =>
      Math.max(1.05, Math.round((100 / Math.max(1, p)) * 100) / 100);
    return {
      home: fromPct(src.prob.home),
      draw: fromPct(src.prob.draw),
      away: fromPct(src.prob.away),
    };
  }
  return { ...DEFAULT_WINNER };
}

/** True when the prices are the synthesized fallback (no real book open yet). */
export function isIndicativeOdds(src: { odds?: unknown | null }): boolean {
  return !src.odds;
}
