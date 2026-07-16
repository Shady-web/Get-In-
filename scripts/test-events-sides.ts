// Verify the replay/live feed attributes goals to the correct side even when
// the incidents feed uses venue home/away opposite to Participant1/Participant2
// (the "inverse score" bug), and that friendlies are recognised for filtering.

import { buildMatchEvents } from "@/lib/match-events";
import type { ScoreFrame } from "@/lib/replay-core";

let failures = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "OK  " : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

// Final score in our convention: Participant1 (home) 1, Participant2 (away) 3.
const frame = (t: number, minute: number, h: number, a: number): ScoreFrame =>
  ({
    t,
    minute,
    ts: t,
    corners: 0,
    statusId: null,
    score: { home: h, away: a },
    red: { home: 0, away: 0 },
    yellow: { home: 0, away: 0 },
  }) as unknown as ScoreFrame;

const frames: ScoreFrame[] = [
  frame(0, 0, 0, 0),
  frame(600, 10, 1, 0),
  frame(1800, 30, 1, 1),
  frame(3600, 60, 1, 2),
  frame(5100, 85, 1, 3),
];

// Incidents feed reports by VENUE side, and here Participant1 is the AWAY team,
// so the feed's "home" goals are actually Participant2's. Result before the
// fix: 3 goals under Participant1, 1 under Participant2 - inverted.
const invertedIncidents = [
  { Type: "goal", Minute: 10, IsHome: false, PlayerName: "P1 Striker" }, // Participant1 goal
  { Type: "goal", Minute: 30, IsHome: true, PlayerName: "P2 A" },
  { Type: "goal", Minute: 60, IsHome: true, PlayerName: "P2 B" },
  { Type: "goal", Minute: 85, IsHome: true, PlayerName: "P2 C" },
];

const events = buildMatchEvents(frames, invertedIncidents);
const homeGoals = events.filter((e) => e.kind === "goal" && e.team === "home").length;
const awayGoals = events.filter((e) => e.kind === "goal" && e.team === "away").length;
ok("home (Participant1) shows 1 goal, matching the frames", homeGoals === 1);
ok("away (Participant2) shows 3 goals, matching the frames", awayGoals === 3);
ok(
  "the lone Participant1 goal keeps its scorer name",
  events.some((e) => e.kind === "goal" && e.team === "home" && e.player === "P1 Striker"),
);

// Control: when the feed is ALREADY aligned, nothing is flipped.
const alignedIncidents = [
  { Type: "goal", Minute: 10, IsHome: true, PlayerName: "P1 Striker" },
  { Type: "goal", Minute: 30, IsHome: false, PlayerName: "P2 A" },
  { Type: "goal", Minute: 60, IsHome: false, PlayerName: "P2 B" },
  { Type: "goal", Minute: 85, IsHome: false, PlayerName: "P2 C" },
];
const aligned = buildMatchEvents(frames, alignedIncidents);
ok(
  "already-correct feed is left untouched (1 home / 3 away)",
  aligned.filter((e) => e.kind === "goal" && e.team === "home").length === 1 &&
    aligned.filter((e) => e.kind === "goal" && e.team === "away").length === 3,
);

// Friendly detection used by the fixture filter.
const isFriendly = (c: string) => /friendl/i.test(c);
ok("'International Friendlies' is a friendly", isFriendly("International Friendlies"));
ok("'Club Friendlies' is a friendly", isFriendly("Club Friendlies"));
ok("'World Cup' is NOT a friendly", !isFriendly("World Cup"));

console.log(failures === 0 ? "\nALL EVENT-SIDE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
