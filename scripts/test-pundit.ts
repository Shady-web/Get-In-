// Unit tests for the Pundit event derivation (pure, no network):
//   npx tsx scripts/test-pundit.ts

import { derivePunditEvents } from "../lib/pundit";
import type { OddsFrame, ScoreFrame } from "../lib/replay-core";

const teams = { home: "Ghana", away: "Japan" };

const sf = (
  t: number,
  home: number,
  away: number,
  red?: { home: number; away: number },
): ScoreFrame => ({
  t,
  ts: 1_700_000_000_000 + t * 1000,
  score: { home, away },
  corners: 0,
  red,
  statusId: "H1",
});

const of = (t: number, home: number, draw: number): OddsFrame => ({
  t,
  prob: { home, draw, away: 100 - home - draw },
  odds: { home: 100 / home, draw: 100 / draw, away: 100 / (100 - home - draw) },
  bookmaker: "Test",
});

let passed = 0;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}

// 1. Goals produce one event per new scoreline, keyed by the scoreline.
{
  const ev = derivePunditEvents(
    [sf(0, 0, 0), sf(720, 1, 0), sf(2580, 1, 1), sf(4680, 2, 1)],
    [],
    teams,
  );
  check("goal keys", ev.map((e) => e.key), ["goal:1-0", "goal:1-1", "goal:2-1"]);
  check("goal minutes", ev.map((e) => e.minute), [12, 43, 78]);
  check("goal kinds", ev.map((e) => e.kind), ["goal", "goal", "goal"]);
}

// 2. Red cards, including frames without the red field (older shape).
{
  const ev = derivePunditEvents(
    [sf(0, 0, 0), sf(3600, 0, 0, { home: 0, away: 1 }), sf(4000, 0, 0)],
    [],
    teams,
  );
  check("red key", ev.map((e) => e.key), ["red:away:1"]);
  check("red minute", ev.map((e) => e.minute), [60]);
}

// 3. Swings: anchor walk, only moves > 15 points, anchor resets on emit.
{
  const ev = derivePunditEvents(
    [sf(0, 0, 0)],
    [of(0, 45, 28), of(720, 62, 24), of(1000, 60, 25), of(2580, 38, 34), of(4680, 78, 16)],
    teams,
  );
  check(
    "swing keys",
    ev.map((e) => e.key),
    ["swing:home:45-62", "swing:home:62-38", "swing:home:38-78"],
  );
}

// 4. A quiet match generates nothing.
{
  const ev = derivePunditEvents([sf(0, 0, 0), sf(2700, 0, 0)], [of(0, 40, 30), of(2700, 44, 29)], teams);
  check("quiet match", ev.length, 0);
}

// 5. Score corrections (VAR) do not duplicate events.
{
  const ev = derivePunditEvents(
    [sf(0, 0, 0), sf(600, 1, 0), sf(700, 0, 0), sf(900, 1, 0)],
    [],
    teams,
  );
  check("VAR dedupe", ev.map((e) => e.key), ["goal:1-0"]);
}

// 6. Determinism: identical input, identical keys (the replay cache contract).
{
  const frames = [sf(0, 0, 0), sf(720, 1, 0), sf(3600, 1, 0, { home: 1, away: 0 })];
  const odds = [of(0, 45, 28), of(3600, 25, 30)];
  const a = derivePunditEvents(frames, odds, teams).map((e) => e.key);
  const b = derivePunditEvents(frames, odds, teams).map((e) => e.key);
  check("deterministic", a, b);
  check("mixed kinds ordered", a, ["goal:1-0", "red:home:1", "swing:home:45-25"]);
}

console.log(`pundit derivation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
