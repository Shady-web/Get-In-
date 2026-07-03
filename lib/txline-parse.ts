// Normalizers for REAL TxLINE payloads (server-only).
//
// The live API differs from the published OpenAPI spec in important ways,
// verified against production data (see sample-odds.json):
//   - Keys are PascalCase: Clock {Running, Seconds}, Score, StatusId, Seq, Ts
//   - StatusId is NUMERIC (1..19, see STATUS_CODES) rather than "H1"/"PE"
//   - Zero values are OMITTED (a 0-0 score has no Goals field at all)
//   - Updates arrive UNSORTED (sort by Seq/Ts before folding)
//   - Match-winner odds are SuperOddsType "1X2_PARTICIPANT_RESULT" with
//     PriceNames ["part1","draw","part2"] and MarketPeriod null for FT
// The spec's camelCase shapes are still accepted as a fallback so tests and
// the mock server keep working.

// Game Phase Encoding (docs: scores/soccer-feed).
export const STATUS_CODES: Record<number, string> = {
  1: "NS",
  2: "H1",
  3: "HT",
  4: "H2",
  5: "F",
  6: "WET",
  7: "ET1",
  8: "HTET",
  9: "ET2",
  10: "FET",
  11: "WPE",
  12: "PE",
  13: "FPE",
  14: "I",
  15: "A",
  16: "C",
  17: "TXCC",
  18: "TXCS",
  19: "P",
};

/** Normalize any status representation to a code string like "H1"/"PE". */
export function statusCode(raw: unknown): string | null {
  if (typeof raw === "number") return STATUS_CODES[raw] ?? null;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && STATUS_CODES[n]) return STATUS_CODES[n];
    return raw;
  }
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw as object);
    if (keys.length > 0) return keys[0];
  }
  return null;
}

/** First defined property among the given keys. */
function pick(obj: any, ...keys: string[]): any {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
  }
  return undefined;
}

export interface FoldedScores {
  score: { home: number; away: number } | null;
  corners: number | null;
  statusId: string | null;
  clockSeconds: number | null;
  clockRunning: boolean;
}

interface NormalizedScoreEntry {
  seq: number;
  ts: number;
  status: string | null;
  clockSeconds: number | null;
  clockRunning: boolean;
  score: { home: number; away: number } | null;
  corners: number | null;
}

function normalizeScoreEntry(entry: unknown): NormalizedScoreEntry | null {
  const u = (entry as any)?.data ?? entry;
  if (!u || typeof u !== "object") return null;

  const status =
    statusCode(pick(u, "statusSoccerId")) ?? statusCode(pick(u, "StatusId", "statusId"));

  const clock = pick(u, "Clock", "clock");
  const clockSeconds =
    typeof pick(clock ?? {}, "Seconds", "seconds") === "number"
      ? pick(clock, "Seconds", "seconds")
      : null;
  const clockRunning = Boolean(pick(clock ?? {}, "Running", "running"));

  const scoreObj = pick(u, "Score", "scoreSoccer");
  let score: { home: number; away: number } | null = null;
  let corners: number | null = null;
  if (scoreObj && typeof scoreObj === "object") {
    const p1 = pick(scoreObj, "Participant1") ?? {};
    const p2 = pick(scoreObj, "Participant2") ?? {};
    const t1 = pick(p1, "Total") ?? {};
    const t2 = pick(p2, "Total") ?? {};
    // Zero values are omitted in the real feed: missing means 0.
    score = { home: Number(t1.Goals ?? 0), away: Number(t2.Goals ?? 0) };
    corners = Number(t1.Corners ?? 0) + Number(t2.Corners ?? 0);
  }

  return {
    seq: Number(pick(u, "Seq", "seq") ?? 0),
    ts: Number(pick(u, "Ts", "ts") ?? 0),
    status,
    clockSeconds,
    clockRunning,
    score,
    corners,
  };
}

function sortedScoreEntries(raw: unknown): NormalizedScoreEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw
    .map(normalizeScoreEntry)
    .filter((e): e is NormalizedScoreEntry => e !== null);
  entries.sort((a, b) => a.seq - b.seq || a.ts - b.ts);
  return entries;
}

/** Fold all updates into the latest known state (for live views). */
export function foldScores(raw: unknown): FoldedScores {
  const out: FoldedScores = {
    score: null,
    corners: null,
    statusId: null,
    clockSeconds: null,
    clockRunning: false,
  };
  for (const e of sortedScoreEntries(raw)) {
    if (e.status) out.statusId = e.status;
    // Some event types (e.g. amendments) carry a zeroed Clock; never let a
    // 0 overwrite a real in-play clock.
    if (e.clockSeconds !== null && (e.clockSeconds > 0 || out.clockSeconds === null)) {
      out.clockSeconds = e.clockSeconds;
      out.clockRunning = e.clockRunning;
    }
    if (e.score) out.score = e.score;
    if (e.corners !== null) out.corners = e.corners;
  }
  return out;
}

/** Per-update frames for replay timelines. */
export interface RawScoreFrame {
  t: number;
  ts: number;
  score: { home: number; away: number };
  corners: number;
  statusId: string | null;
}

export function scoreEntryFrames(raw: unknown): RawScoreFrame[] {
  const frames: RawScoreFrame[] = [];
  let last: RawScoreFrame | null = null;
  for (const e of sortedScoreEntries(raw)) {
    const t = e.clockSeconds ?? last?.t;
    if (t === undefined) continue;
    const frame: RawScoreFrame = {
      t,
      ts: e.ts || (last?.ts ?? 0),
      score: e.score ?? last?.score ?? { home: 0, away: 0 },
      corners: e.corners ?? last?.corners ?? 0,
      statusId: e.status ?? last?.statusId ?? null,
    };
    frames.push(frame);
    last = frame;
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

// --- Odds ------------------------------------------------------------------------

const HOME_NAMES = new Set(["1", "home", "h", "part1"]);
const DRAW_NAMES = new Set(["x", "draw", "d"]);
const AWAY_NAMES = new Set(["2", "away", "a", "part2"]);

export interface ParsedMatchOdds {
  prob: { home: number; draw: number; away: number } | null;
  odds: { home: number; draw: number; away: number } | null;
  bookmaker: string | null;
}

export const NO_MATCH_ODDS: ParsedMatchOdds = { prob: null, odds: null, bookmaker: null };

/** Is this payload the full-time match-winner (1X2) market? */
function isFullTime1X2(p: any): boolean {
  if (!Array.isArray(p?.PriceNames) || p.PriceNames.length !== 3) return false;
  const superType = String(p.SuperOddsType ?? "").toUpperCase();
  if (superType && !superType.includes("1X2")) return false;
  const period = String(p.MarketPeriod ?? "").toLowerCase();
  return period === "" || period === "null" || period === "ft" || period.includes("full");
}

/** Convert one 1X2 payload into probabilities + decimal odds. */
export function parseMatchOddsPayload(p: any): ParsedMatchOdds {
  const idx = { home: 0, draw: 1, away: 2 };
  p.PriceNames.forEach((name: unknown, i: number) => {
    const n = String(name ?? "").toLowerCase();
    if (HOME_NAMES.has(n)) idx.home = i;
    else if (DRAW_NAMES.has(n)) idx.draw = i;
    else if (AWAY_NAMES.has(n)) idx.away = i;
  });

  // Pct = implied percentages ("52.632"); preferred over raw prices.
  let implied: number[] | null = null;
  if (Array.isArray(p.Pct) && p.Pct.length === 3) {
    const vals = p.Pct.map((s: unknown) => Number.parseFloat(String(s)));
    if (vals.every((v: number) => Number.isFinite(v) && v > 0)) implied = vals;
  }
  if (!implied && Array.isArray(p.Prices) && p.Prices.length === 3) {
    // Prices are decimal odds x1000 (e.g. 1900 = 1.90) -> implied = 1/odds.
    const vals = p.Prices.map((x: unknown) => {
      const odds = Number(x) / 1000;
      return odds > 1 ? 100 / odds : NaN;
    });
    if (vals.every((v: number) => Number.isFinite(v) && v > 0)) implied = vals;
  }
  if (!implied) return { ...NO_MATCH_ODDS, bookmaker: p.Bookmaker ?? null };

  // Normalize away the bookmaker margin so the three sum to 100.
  const sum = implied[0] + implied[1] + implied[2];
  const pct = (i: number) => Math.round((implied![i] / sum) * 1000) / 10;
  const home = pct(idx.home);
  const draw = pct(idx.draw);
  const away = Math.round((100 - home - draw) * 10) / 10;

  const decimal = (i: number): number => {
    const price = Array.isArray(p.Prices) ? Number(p.Prices[i]) : NaN;
    if (Number.isFinite(price) && price >= 1010 && price <= 1_000_000) {
      return Math.round(price) / 1000;
    }
    return Math.round((100 / implied![i]) * 100) / 100;
  };

  return {
    prob: { home, draw, away },
    odds: { home: decimal(idx.home), draw: decimal(idx.draw), away: decimal(idx.away) },
    bookmaker: p.Bookmaker ?? null,
  };
}

/** Latest full-time 1X2 payload from an odds snapshot/updates array. */
export function latest1X2(raw: unknown): any | null {
  if (!Array.isArray(raw)) return null;
  let best: any = null;
  for (const entry of raw) {
    const p = (entry as any)?.data ?? entry;
    if (!p || !isFullTime1X2(p)) continue;
    if (!best || (p.Ts ?? 0) >= (best.Ts ?? 0)) best = p;
  }
  return best;
}

/** All full-time 1X2 payloads (for replay odds timelines). */
export function all1X2(raw: unknown): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry as any)?.data ?? entry)
    .filter((p) => p && isFullTime1X2(p));
}
