# GetIN — Technical Documentation & TxLINE Feedback

## Brief technical documentation

### Core idea

**GetIN** is a mobile-first World Cup prediction game where fans call match
outcomes and bet against live, real-money-style markets — settled in **devnet
SOL**, so it's playable with zero financial risk. Every fixture, price, score,
and goal/card event is driven by **live TxLINE data**; the same engine also
powers a **Replay Mode** that re-runs finished matches frame-by-frame with their
real odds and events, so there's always something to play between kickoffs.

### Business highlights

- **Real stakes, no risk:** on-chain settlement on Solana devnet (custodial
  wallets, house-funded faucet) gives the feel of live betting without
  regulatory or financial exposure — ideal for growth, demos, and onboarding
  crypto-curious users.
- **Always-on engagement:** live matches, upcoming markets, and Replay Mode mean
  the app is never empty; quests/badges and a live leaderboard drive retention.
- **Fan-first economy:** a coin↔SOL economy pegged to a live SOL price
  (100 coins ≈ $0.00274, priced into SOL at the real market rate), so rewards
  feel tangible.

### Technical highlights

- **Next.js (App Router) + TypeScript + Supabase (auth + Postgres) + Vercel.**
  Identity is a verified Supabase session (email / username / Google, plus a
  **Sign-in-with-Solana** wallet flow verified server-side by ed25519 signature).
- **All TxLINE calls are server-side.** The API token never reaches the browser;
  the client only ever talks to our own `/api/*` routes, which proxy TxLINE and
  normalize its payloads.
- **A normalization layer** folds TxLINE's snapshot / updates / historical feeds
  into a single per-fixture timeline (score frames + odds frames + a goal/card
  event stream), shared by the live view, Replay Mode, and settlement.
- **Robustness baked in:** real match status is derived from the scores feed
  rather than trusting scheduled kickoff times (extra time, penalties, delays);
  monotonic high-water marks prevent double-counting goals when totals
  momentarily drop; and incident-side attribution is reconciled against the
  authoritative score totals so scorers never land on the wrong team.

### Specific TxLINE endpoints used

| Endpoint | Purpose |
|---|---|
| `POST /auth/guest/start` | Bootstrap a guest session token |
| `POST /api/token/activate` | Activate the API token used for all server-side calls |
| `GET /fixtures/snapshot` | The fixtures schedule (optionally `?competitionId=`) |
| `GET /scores/snapshot/{fixtureId}` | Current live score / cards / clock |
| `GET /scores/updates/{fixtureId}` | Incremental in-play score updates |
| `GET /scores/historical/{fixtureId}` | Full historical score timeline (powers Replay Mode) |
| `GET /scores/incidents/{fixtureId}` | Goal / booking incidents with player names |
| `GET /odds/snapshot/{fixtureId}` | Current odds across markets (built into the markets list) |
| `GET /odds/updates/{fixtureId}` | Incremental odds movement (live price ticks + replay odds frames) |

## Feedback on the TxLINE API

### What we liked most

- **The snapshot + updates + historical split is excellent.** Having a full
  snapshot, a lightweight incremental `updates` feed, *and* a `historical`
  endpoint on the same shape is what made both live play and a genuine
  frame-by-frame Replay Mode possible from one normalization layer — we didn't
  have to reconstruct history ourselves.
- **Per-fixture granularity and breadth.** Scores, incidents, and a rich odds
  surface per fixture let us synthesize a full markets board and settle bets
  without stitching together multiple providers.
- **Real-time cadence was reliable enough** to drive live price ticks, a live
  goal/card feed, and win-probability bars that actually move during a match.

### Where we hit friction

- **Two different notions of "home/away."** The scores feed keys everything to
  `Participant1`/`Participant2`, but the incidents feed attributes events by
  *venue* home/away — and those diverge whenever `Participant1IsHome` is false.
  This silently inverted scorers on the feed until we reconciled incident sides
  against the authoritative score totals. A single consistent side convention
  (or an explicit `participantId` on every incident) would prevent a whole class
  of bugs.
- **The incidents payload isn't in the published spec.** We had to parse
  defensively across several plausible key spellings (`Type`/`Kind`,
  `Minute`/`Seconds`, `ParticipantId`/`IsHome`/`Side`, `PlayerName`/`Scorer`). A
  documented incident schema would save real time.
- **Omitted-zero fields.** Missing totals mean "0" rather than absent —
  reasonable once you know it, but it bites at first (phantom "no score" states)
  until you default everything.
- **Ordering quirks:** `Seq` resets per `ConnectionId` and stale events can be
  re-emitted, so we had to sort by wall-clock `Ts` first and treat totals as
  monotonic high-water marks to avoid re-counting a goal.
- **Schedule vs. reality.** `StartTime` alone is unreliable — kickoffs drift and
  matches run long into ET/penalties — so we couldn't trust it for live/finished
  classification and instead cross-check the scores feed. Worth flagging in docs.
- **Mixed competitions in one feed.** International/club friendlies arrive
  through the same fixtures snapshot as the World Cup, so we needed to filter by
  competition to keep the app focused.
- **Auth is a two-step dance** (`guest/start` → `token/activate`); it works, but
  a one-call path or clearer token lifetime/refresh docs would smooth onboarding.

**Net:** the data coverage and the historical endpoint were the standout wins
that unlocked our best feature (Replay), and most of the friction was
documentation and cross-feed consistency rather than the data itself.
