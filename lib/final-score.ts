// Server-only: the score of a fixture for the bet-slip detail view. Reads the
// live snapshot first (covers live and just-finished matches), then falls back
// to the historical feed for older finished matches - the same reason recent
// form needs the fallback. Returns null when no score is known yet.

import { getScoresSnapshot } from "@/lib/scores-snapshot";
import { foldScores } from "@/lib/txline-parse";
import { txlineGet } from "@/lib/txline";
import { isFinal } from "@/lib/game-core";

export interface FixtureScore {
  home: number;
  away: number;
  final: boolean;
}

export async function getFixtureScore(fixtureId: number): Promise<FixtureScore | null> {
  try {
    const s = foldScores(await getScoresSnapshot(fixtureId));
    if (s.score) return { home: s.score.home, away: s.score.away, final: isFinal(s.statusId) };
  } catch {
    /* fall through to the historical feed */
  }
  try {
    const s = foldScores(await txlineGet(`/scores/historical/${fixtureId}`));
    if (s.score) return { home: s.score.home, away: s.score.away, final: isFinal(s.statusId) };
  } catch {
    /* no data for this fixture */
  }
  return null;
}
