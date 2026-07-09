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

// Finished past fixtures so the "Recent form" card has last-3 history.
// [FixtureId, daysAgo, p1, p1Id, p2, p2Id, homeGoals, awayGoals]
const PAST = [
  [90010, 3, "Testland", 1, "Farland", 11, 2, 0],
  [90011, 6, "Nearland", 12, "Testland", 1, 1, 1],
  [90012, 9, "Testland", 1, "Highland", 13, 3, 1],
  [90013, 2, "Mockovia", 2, "Farland", 11, 0, 3],
  [90014, 5, "Nearland", 12, "Mockovia", 2, 2, 1],
  [90015, 8, "Mockovia", 2, "Highland", 13, 1, 1],
];
for (const [id, daysAgo, p1, p1Id, p2, p2Id] of PAST) {
  fixtures.push({
    Ts: started, StartTime: started - daysAgo * 24 * 3600_000,
    Competition: "World Cup", CompetitionId: 72,
    Participant1: p1, Participant2: p2, FixtureId: id,
    Participant1IsHome: true, Participant1Id: p1Id, Participant2Id: p2Id, FixtureGroupId: 9,
  });
}
const pastById = new Map(PAST.map((r) => [r[0], r]));

const RED_CARD_AT = 60 * 60; // Mockovia see red at 60'

const sc = (h, a, ch, ca, rh = 0, ra = 0) => ({
  Participant1: { Total: { Goals: h, YellowCards: 0, RedCards: rh, Corners: ch } },
  Participant2: { Total: { Goals: a, YellowCards: 0, RedCards: ra, Corners: ca } },
});

/** Live match state as a pure function of the match clock. */
function liveAt(t) {
  let h = 0, a = 0;
  for (const [gt, gh, ga] of GOALS) if (t >= gt) { h = gh; a = ga; }
  const corners = Math.floor(t / CORNER_EVERY);
  const status = t >= FT_SECONDS ? "F" : t >= 46 * 60 ? "H2" : t >= 45 * 60 ? "HT" : "H1";
  const ra = t >= RED_CARD_AT ? 1 : 0;
  return { h, a, corners, status, ra };
}

/**
 * Score snapshot as a HISTORY of updates (like the real feed): one entry per
 * event so far plus a current heartbeat. The Pundit ticker derives goal and
 * red-card events from this history.
 */
function liveScoreEntries(tNow) {
  const checkpoints = [
    0,
    ...GOALS.map(([gt]) => gt).filter((gt) => gt <= tNow),
    ...(tNow >= RED_CARD_AT ? [RED_CARD_AT] : []),
    Math.floor(tNow),
  ].sort((x, y) => x - y);
  return checkpoints.map((t, i) => {
    const { h, a, corners, status, ra } = liveAt(t);
    return {
      fixtureId: 90001, ts: kickoffLive + t * 1000, seq: i + 1,
      statusSoccerId: status,
      clock: { running: status === "H1" || status === "H2", seconds: t },
      scoreSoccer: sc(h, a, Math.ceil(corners / 2), Math.floor(corners / 2), 0, ra),
    };
  });
}

// Deterministic 1X2 history for /odds/updates/90001: same data every call,
// so the Pundit swing keys are stable. Home prob path has 4 swings > 15pts.
const LIVE_ODDS_SCRIPT = [
  [0, 44, 28],
  [18 * 60, 62, 22],
  [27 * 60, 40, 32],
  [40 * 60, 58, 26],
  [51 * 60, 63, 22],
  [RED_CARD_AT, 74, 16],
  [74 * 60, 84, 10],
];
function liveOddsUpdates(tNow) {
  return LIVE_ODDS_SCRIPT.filter(([t]) => t <= tNow).map(([t, ph, pd], i) => {
    const pcts = [ph, pd, 100 - ph - pd];
    return {
      FixtureId: 90001, MessageId: `u${i}`, Ts: kickoffLive + t * 1000,
      Bookmaker: "MockPrice", BookmakerId: 7,
      SuperOddsType: "1X2_PARTICIPANT_RESULT", InRunning: t > 0,
      MarketPeriod: null, MarketParameters: null,
      PriceNames: ["part1", "draw", "part2"],
      Prices: pcts.map((p) => Math.round(100000 / p)),
      Pct: pcts.map((p) => p.toFixed(3)),
    };
  });
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

// [t, status, homeGoals, awayGoals, homeCorners, awayCorners, awayReds]
// Japan (away) pick up a red card at 60'.
const replayScript = [
  [0, "H1", 0, 0, 0, 0, 0],
  [300, "H1", 0, 0, 1, 0, 0],
  [720, "H1", 1, 0, 1, 0, 0],
  [1500, "H1", 1, 0, 2, 1, 0],
  [2580, "H1", 1, 1, 3, 1, 0],
  [2700, "HT", 1, 1, 3, 1, 0],
  [2700, "H2", 1, 1, 3, 1, 0],
  [3600, "H2", 1, 1, 4, 2, 1],
  [4680, "H2", 2, 1, 5, 2, 1],
  [5400, "H2", 2, 1, 5, 3, 1],
  [5640, "F", 2, 1, 5, 3, 1],
];
const replayScores = replayScript.map(([t, st, h, a, ch, ca, ra], i) => ({
  fixtureId: 90003, ts: kickoffReplay + t * 1000, seq: i + 1, statusSoccerId: st,
  clock: { running: st !== "HT" && st !== "F", seconds: t },
  scoreSoccer: sc(h, a, ch, ca, 0, ra),
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
  // The browser calls the fake GoTrue below cross-origin (3000 -> 3998).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const json = (body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  // --- Fake Supabase GoTrue (just enough for dev:mock sign-in) --------------
  const mockUser = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "punditfan@example.com",
    user_metadata: { username: "punditfan" },
    app_metadata: { provider: "email" },
    created_at: new Date(started).toISOString(),
  };
  if (req.url.startsWith("/auth/v1/token")) {
    return json({
      access_token: "mock-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "mock-refresh-token",
      user: mockUser,
    });
  }
  if (req.url.startsWith("/auth/v1/user")) return json(mockUser);
  if (req.url.startsWith("/auth/v1/logout")) return res.writeHead(204).end();

  // Fake Gemini for the Pundit ticker (dev-mock points GEMINI_API_BASE here).
  if (req.method === "POST" && req.url.startsWith("/v1beta/models/")) {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      let prompt = "";
      try { prompt = JSON.stringify(JSON.parse(buf).contents ?? ""); } catch { /* canned */ }
      const take = prompt.includes("RED CARD")
        ? "Ten men changes everything: the market is piling onto the other side and the draw price is collapsing fast."
        : prompt.includes("GOAL")
          ? "That goal flips the script: the bookmakers now make the scorers firm favourites and momentum money is flooding in."
          : "Sharp money on the move: a swing that size with no goal means the traders have seen something the crowd has not.";
      json({ candidates: [{ content: { parts: [{ text: take }] } }] });
    });
    return;
  }

  if (req.url === "/auth/guest/start") return json({ token: "mock-jwt" });
  if (req.url.startsWith("/api/fixtures/snapshot")) return json(fixtures);

  // Finished past fixtures for the Recent-form card: a single FT entry.
  {
    const m = /^\/api\/(scores|odds)\/snapshot\/(\d+)/.exec(req.url);
    if (m && pastById.has(Number(m[2]))) {
      if (m[1] === "odds") return json([]);
      const [id, , , , , , h, a] = pastById.get(Number(m[2]));
      return json([
        {
          fixtureId: id, ts: Date.now(), seq: 1, statusSoccerId: "F",
          clock: { running: false, seconds: 5640 },
          scoreSoccer: sc(h, a, 4, 3),
        },
      ]);
    }
  }

  if (req.url.startsWith("/api/scores/historical/90003")) return json(replayScores);
  if (req.url.startsWith("/api/odds/updates/90003")) return json(replayOdds);

  if (req.url.startsWith("/api/scores/snapshot/90001")) {
    const t = Math.min((Date.now() - kickoffLive) / 1000, FT_SECONDS);
    return json(liveScoreEntries(t));
  }
  if (req.url.startsWith("/api/odds/snapshot/90001")) {
    const t = Math.min((Date.now() - kickoffLive) / 1000, FT_SECONDS);
    return json(oddsAt(t));
  }
  if (req.url.startsWith("/api/odds/updates/90001")) {
    const t = Math.min((Date.now() - kickoffLive) / 1000, FT_SECONDS);
    return json(liveOddsUpdates(t));
  }
  if (req.url.startsWith("/api/odds/updates/90002")) return json([]);

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
