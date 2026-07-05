// Unit tests for the daily-quest rotation + progress math (pure, no DB):
//   npx tsx scripts/test-quests.ts

import {
  QUEST_POOL,
  QUESTS_PER_DAY,
  dailyQuests,
  dayKey,
  type QuestRows,
} from "../lib/quests";

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

const slip = (over: Partial<QuestRows["slips"][number]>): QuestRows["slips"][number] => ({
  legs: 1,
  stake: 50,
  status: "pending",
  placedToday: true,
  settledToday: false,
  ...over,
});
const rows = (slips: QuestRows["slips"], predictionsWonToday = 0): QuestRows => ({
  slips,
  predictionsWonToday,
});
const progress = (id: string, r: QuestRows) => QUEST_POOL.find((q) => q.id === id)!.progress(r);

// 1. Rotation: 3 distinct quests, deterministic for a given day.
{
  const day = 20_640; // arbitrary fixed day number
  const a = dailyQuests(day).map((q) => q.id);
  const b = dailyQuests(day).map((q) => q.id);
  check("deterministic per day", a, b);
  check("three quests", a.length, QUESTS_PER_DAY);
  check("distinct quests", new Set(a).size, QUESTS_PER_DAY);
}

// 2. Rotation actually rotates across a week.
{
  const sets = new Set<string>();
  for (let d = 20_640; d < 20_647; d++) {
    sets.add(dailyQuests(d).map((q) => q.id).sort().join(","));
  }
  check("varies across a week", sets.size > 1, true);
}

// 3. place_3 counts slips placed today, any status.
check(
  "place_3",
  progress("place_3", rows([slip({}), slip({ status: "lost" }), slip({ placedToday: false })])),
  2,
);

// 4. win_singles_2: only 1-leg slips that WON and settled today.
check(
  "win_singles_2",
  progress(
    "win_singles_2",
    rows([
      slip({ status: "won", settledToday: true }),
      slip({ status: "won", settledToday: true, legs: 3 }), // acca: no
      slip({ status: "won", settledToday: false }), // settled another day: no
      slip({ status: "lost", settledToday: true }), // lost: no
    ]),
  ),
  1,
);

// 5. win_acca needs 2+ legs.
check(
  "win_acca",
  progress(
    "win_acca",
    rows([
      slip({ status: "won", settledToday: true, legs: 2 }),
      slip({ status: "won", settledToday: true, legs: 1 }),
    ]),
  ),
  1,
);

// 6. cashout_1 counts cashed slips settled today.
check(
  "cashout_1",
  progress(
    "cashout_1",
    rows([slip({ status: "cashed", settledToday: true }), slip({ status: "cashed" })]),
  ),
  1,
);

// 7. stake_300 sums today's stakes only.
check(
  "stake_300",
  progress(
    "stake_300",
    rows([slip({ stake: 200 }), slip({ stake: 150 }), slip({ stake: 999, placedToday: false })]),
  ),
  350,
);

// 8. predict_5 comes straight off the counter.
check("predict_5", progress("predict_5", rows([], 4)), 4);

// 9. Day key shape (drives the quest_claims.day column).
check("dayKey shape", /^\d{4}-\d{2}-\d{2}$/.test(dayKey()), true);

console.log(`daily quests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
