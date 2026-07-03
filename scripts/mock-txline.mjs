// Mock TxLINE server for local testing WITHOUT a real live match.
//
//   npm run dev:mock
//
// Serves three fixtures on http://127.0.0.1:3998 :
//   90001 Testland vs Mockovia  - LIVE: kicked off 15 min before you started
//         this server, with goals scripted at 18', 27', 51', 74' and corners
//         every few minutes, so picks settle while you watch.
//   90002 Upcomia vs Futuria    - upcoming (odds preview).
//   90003 Ghana vs Japan        - finished 8h ago, full history for Replay.
//
// Your real Supabase env still applies, so picks, settlement, points,
// streaks and the leaderboard all work end to end against fake matches.

import http from "node:http";

const PORT = 3998;
const started = Date.now();
const kickoffLive = started - 15 * 60_000; // 15 minutes into the match
const kickoffReplay = started - 8 * 3600_000;

// [clockSeconds, homeGoals, awayGoals] - cumulative
const GOALS = [
  [18 * 60, 1, 0],
  [27 * 60, 1, 1],
  [51 * 60, 2, 1],
  [74 * 60, 3, 1],
];
const CORNER_EVERY = 350; // a corner roughly every ~6 minutes
const FT_SECONDS = 94 * 60;

const fixtures = [
  {
    Ts: started, StartTime: kickoffLive, Competition: "World Cup", CompetitionId: 72,
    Participant1: "Testland", Participant2: "Mockovia", FixtureId: 90001,
    Participant1IsHome: true, Participant1Id: 1, Participant2Id: 2, FixtureGroupId: 9,
  },
  {
    Ts: started, StartTime: started + 3 * 3600_000, Competition: "World Cup", CompetitionId: 72,
    Participant1: "Upcomia", Participant2: "Futuria", FixtureId: 90002,
    Participant1IsHome: true, Participant1Id: 3, Participant2Id: 4, FixtureGroupId: 9,
  },
  {
    Ts: started, StartTime: kickoffReplay, Competition: "World Cup", CompetitionId: 72,
    Participant1: "Ghana", Participant2: "Japan", FixtureId: 90003,
    Participant1IsHome: true, Participant1Id: 7, Participant2Id: 8, FixtureGroupId: 9,
  },
];

const sc = (h, a, ch, ca) => ({
  Participant1: { Total: { Goals: h, YellowCards: 0, RedCards: 0, Corners: ch } },
  Participant2: { Total: { Goals: a, YellowCards: 0, RedCards: 0, Corners: ca } },
});

/** Live match state as a pure function of the match clock. */
function liveAt(t) {
  let h = 0, a = 0;
  for (const [gt, gh, ga] of GOALS) if (t >= gt) { h = gh; a = ga; }
  const corners = Math.floor(t / CORNER_EVERY);
  const status = t >= FT_SECONDS ? "F" : t >= 46 * 60 ? "H2" : t >= 45 * 60 ? "HT" : "H1";
  return { h, a, corners, status };
}

/** Build one odds payload in the REAL TxLINE shape. */
function payload(superType, period, params, names, pcts) {
  return {
    FixtureId: 90001, MessageId: `m${superType}${params ?? ""}${Date.now()}`,
    Ts: Date.now(), Bookmaker: "MockPrice", BookmakerId: 7,
    SuperOddsType: superType, InRunning: true,
    MarketPeriod: period, MarketParameters: params,
    PriceNames: names,
    Prices: pcts.map((p) => Math.round(100000 / p)),
    Pct: pcts.map((p) => p.toFixed(3)),
  };
}

/** Odds drift with the score (plus jitter so Markets prices tick visibly). */
function oddsAt(t) {
  const { h, a } = liveAt(t);
  const lead = h - a;
  const jit = (k) => Math.sin(Date.now() / 9000 + k) * 2.5;
  const pHome = Math.min(88, Math.max(8, 44 + lead * 18 - t / 600 + jit(1)));
  const pDraw = Math.min(40, Math.max(6, 28 - Math.abs(lead) * 9 + t / 900 + jit(2)));
  const pAway = Math.max(4, 100 - pHome - pDraw);
  const pOver = Math.min(90, Math.max(10, 55 - t / 200 + jit(3)));
  const pPart1 = Math.min(92, Math.max(8, 52 + lead * 14 + jit(4)));
  return [
    payload("1X2_PARTICIPANT_RESULT", null, null, ["part1", "draw", "part2"], [pHome, pDraw, pAway]),
    payload("OVERUNDER_PARTICIPANT_GOALS", null, "line=2.5", ["over", "under"], [pOver, 100 - pOver]),
    payload("OVERUNDER_PARTICIPANT_GOALS", null, "line=3.5", ["over", "under"], [pOver * 0.6, 100 - pOver * 0.6]),
    payload("ASIANHANDICAP_PARTICIPANT_GOALS", null, "line=-0.5", ["part1", "part2"], [pPart1, 100 - pPart1]),
    payload("OVERUNDER_PARTICIPANT_GOALS", "half=1", "line=1.5", ["over", "under"], [pOver * 0.8, 100 - pOver * 0.8]),
  ];
}

// --- Replay history for 90003 (fixed script) --------------------------------

const replayScript = [
  [0, "H1", 0, 0, 0, 0],
  [300, "H1", 0, 0, 1, 0],
  [720, "H1", 1, 0, 1, 0],
  [1500, "H1", 1, 0, 2, 1],
  [2580, "H1", 1, 1, 3, 1],
  [2700, "HT", 1, 1, 3, 1],
  [2700, "H2", 1, 1, 3, 1],
  [3600, "H2", 1, 1, 4, 2],
  [4680, "H2", 2, 1, 5, 2],
  [5400, "H2", 2, 1, 5, 3],
  [5640, "F", 2, 1, 5, 3],
];
const replayScores = replayScript.map(([t, st, h, a, ch, ca], i) => ({
  fixtureId: 90003, ts: kickoffReplay + t * 1000, seq: i + 1, statusSoccerId: st,
  clock: { running: st !== "HT" && st !== "F", seconds: t },
  scoreSoccer: sc(h, a, ch, ca),
}));
const replayOdds = [
  [0, "45.000", "28.000", "27.000"],
  [720, "62.000", "24.000", "14.000"],
  [2580, "38.000", "34.000", "28.000"],
  [4680, "78.000", "16.000", "6.000"],
].map(([t, p1, px, p2], i) => ({
  FixtureId: 90003, MessageId: `o${i}`, Ts: kickoffReplay + Number(t) * 1000,
  Bookmaker: "MockPrice", BookmakerId: 7, SuperOddsType: "1x2", InRunning: t > 0,
  MarketPeriod: "FT", PriceNames: ["1", "X", "2"],
  Prices: [p1, px, p2].map((p) => Math.round(100000 / parseFloat(p))),
  Pct: [p1, px, p2],
}));

// --- Server -----------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const json = (body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.url === "/auth/guest/start") return json({ token: "mock-jwt" });
  if (req.url.startsWith("/api/fixtures/snapshot")) return json(fixtures);

  if (req.url.startsWith("/api/scores/historical/90003")) return json(replayScores);
  if (req.url.startsWith("/api/odds/updates/90003")) return json(replayOdds);

  if (req.url.startsWith("/api/scores/snapshot/90001")) {
    const t = Math.min((Date.now() - kickoffLive) / 1000, FT_SECONDS);
    const { h, a, corners, status } = liveAt(t);
    return json([
      {
        fixtureId: 90001, ts: Date.now(), seq: Math.floor(t), statusSoccerId: status,
        clock: { running: status === "H1" || status === "H2", seconds: Math.floor(t) },
        scoreSoccer: sc(h, a, Math.ceil(corners / 2), Math.floor(corners / 2)),
      },
    ]);
  }
  if (req.url.startsWith("/api/odds/snapshot/90001")) {
    const t = Math.min((Date.now() - kickoffLive) / 1000, FT_SECONDS);
    return json(oddsAt(t));
  }

  // Upcoming fixture: no scores yet, pre-match odds only.
  if (req.url.startsWith("/api/scores/snapshot/90002")) return json([]);
  if (req.url.startsWith("/api/odds/snapshot/90002")) {
    return json([
      {
        FixtureId: 90002, MessageId: "pre", Ts: Date.now(), Bookmaker: "MockPrice",
        BookmakerId: 7, SuperOddsType: "1x2", InRunning: false, MarketPeriod: "FT",
        PriceNames: ["1", "X", "2"], Prices: [2100, 3300, 3600],
        Pct: ["47.619", "30.303", "27.778"],
      },
    ]);
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => {
  const mins = Math.floor((Date.now() - kickoffLive) / 60000);
  console.log(`[mock-txline] up on http://127.0.0.1:${PORT}`);
  console.log(`[mock-txline] Testland vs Mockovia is LIVE at minute ${mins}'`);
  console.log(`[mock-txline] goals land at 18' 27' 51' 74'; FT at 94'`);
});
