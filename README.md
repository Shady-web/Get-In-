# GetIN!!!

A mobile-first (and desktop-friendly) World Cup live prediction game.
Watch live matches, call what happens next before it happens, earn points
scaled by the real odds, build streaks, and climb a global leaderboard.
Finished matches can be replayed on a timeline and played like they're live.

Built for a World Cup hackathon with **Next.js (App Router) + TypeScript +
Supabase + Vercel**, on live data from the **TxLINE** sports API (free
on-chain World Cup tier, Solana).

## How it works

- **Identity without auth**: connect a Phantom wallet or just pick a
  nickname. The players table keys on `wallet_or_nickname`; there is no
  Supabase Auth.
- **Live matches**: score, match clock, and a win-probability bar derived
  from the TxLINE 1X2 market (margin normalized away), updating every ~7s.
- **The game**: every minute of match time deals a prediction card
  (full-time result, goal-before-minute-X, corner-before-minute-X).
  Points = round(odds x 10), so unlikely calls pay more. Picks store the
  odds snapshot; settlement is automatic (correct picks add points and
  extend your streak, a miss resets it to 0).
- **Replay Mode**: finished matches (started 6h-2w ago) replay on a
  timeline with a scrubber and x1/x10/x60 speed. Cards price from the odds
  as they stood at that moment; scoring works exactly like live.
- **Coin economy**: every player starts with 1,000 coins and can claim 500
  daily. Tap any full-time price (Markets tab, or the winner odds in a
  replay) to build a Bet Slip: one selection = single, several (across
  matches) = accumulator at the product of leg odds. Slips settle
  automatically from the scores data - in live matches and in Replay Mode.
  Open slips show a live Cash Out value (potential return x current implied
  probability of the pending legs x 0.95) that animates as odds move.
- **My Bets tab**: every slip with live cash-out values; open and settled
  history in one place.
- **Private rooms**: create a room, get a 6-char code + share link, friends
  join and compete on a live per-room leaderboard ranked by coin profit
  since joining, with rank-change animations.
- **Pundit ticker**: a scrolling feed of one-line AI hot takes on the match
  screen. A take is generated ONLY when a goal, a red card, or a >15-point
  win-probability swing happens (Gemini, gemini-2.0-flash, free tier), max
  12 per match, cached in Supabase so replays never re-call the AI.
- **Daily quests**: 3 rotating challenges a day (win 2 singles, land an
  accumulator, ...) with coin rewards. The rotation is deterministic from
  the date; progress is computed from data the app already stores and each
  reward is claimable once per day.
- **Badges**: milestone trophies (First Win, first cash out, 5-leg parlay
  win, 10-win streak, 5,000-coin bankroll) awarded retroactively and kept
  forever, shown as a badge wall in the Leaders tab.
- **Pro screen**: a monetization demo tab showing what a paid tier would
  unlock (full odds-history charts, market alerts, double daily claim)
  with a mock upgrade flow. No payments are wired up; "upgrading" flips a
  local demo flag so the before/after is visible.
- **Leaderboard**: global top 20 ranked by coin bankroll, live via Supabase
  Realtime (or polling fallback), plus a downloadable streak share card.

## Security model

- TxLINE tokens live ONLY on the server (`.env.local` / Vercel env vars).
  The browser talks to our own `/api/*` routes; those routes talk to TxLINE.
- Supabase RLS is enabled with a single read-only policy on `players`
  (for the realtime leaderboard). All writes go through server routes
  using the service-role key.

## Setup

### 1. Install

```bash
npm install
```

### 2. Get a TxLINE API token (one time)

```bash
cp .env.example .env      # set NETWORK=devnet (or mainnet)
npm run setup:txline
```

The script generates a Solana keypair (gitignored), pauses while you fund
it (devnet faucet or a little real SOL), subscribes on-chain to the free
World Cup tier (service level 12 on mainnet, 1 on devnet), activates and
prints your API token.

### 3. Supabase

Create a project at supabase.com, then run in the SQL editor:

1. `supabase/schema.sql`
2. `supabase/schema-v2.sql`
3. `supabase/schema-v3.sql`
4. `supabase/schema-v4.sql`
5. `supabase/schema-v5.sql`
6. `supabase/schema-v6.sql`
7. `supabase/schema-v7.sql`

### 4. Environment

Create `.env.local`:

```bash
# TxLINE (printed by the setup script)
TXLINE_NETWORK=devnet
TXLINE_API_TOKEN=...
TXLINE_API_BASE=https://txline-dev.txodds.com/api

# Supabase (Project Settings -> API)
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

# Optional: realtime leaderboard (public anon key is browser-safe)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Optional: Pundit ticker (free key: aistudio.google.com -> Get API key).
# Server-side only. If unset, the ticker simply hides itself.
GEMINI_API_KEY=...
```

### 5. Run

```bash
npm run dev
```

## Testing without a live match

Most features (goals, settlement, streaks) normally need a match in play.
Two ways around that:

- **Replay Mode** (real data): open any finished match from the Replay
  section; the full game loop (cards, picks, settlement, points,
  leaderboard) runs against its real history.
- **Mock mode** (no TxLINE needed):

  ```bash
  npm run dev:mock
  ```

  Starts a fake TxLINE server plus the app pointed at it. "Testland vs
  Mockovia" is always live (kicked off 15 minutes before you started, with
  goals at 18', 27', 51', 74'), there's an upcoming fixture with pre-match
  odds, and "Ghana vs Japan" is replayable. Your Supabase env still
  applies, so picks settle and score for real. Only TXLINE_* is
  overridden; your real token is untouched.

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel (framework preset:
   Next.js; no special build settings needed).
2. Add the same variables from `.env.local` in Project Settings ->
   Environment Variables. Keep `TXLINE_API_TOKEN` and
   `SUPABASE_SERVICE_ROLE_KEY` server-side only (never prefix them with
   `NEXT_PUBLIC_`).
3. Deploy. The `/api/*` routes run as serverless functions, so tokens stay
   server-side in production too.

## API routes (browser -> our server -> TxLINE)

| Route | What it does |
|---|---|
| `GET /api/worldcup` | Fixtures schedule (optional `?competitionId=`) |
| `GET /api/live/{fixtureId}` | Live score/clock/probabilities, cached ~7s |
| `GET /api/replay/{fixtureId}` | Full historical timeline for playback |
| `GET /api/game/card` | Current prediction card (+ settles picks & slips) |
| `POST /api/game/pick` | Save a pick with its odds snapshot |
| `GET /api/markets/{fixtureId}` | Every priced market, normalized |
| `GET /api/pundit/{fixtureId}` | Pundit ticker takes (live, or `?vt=` for replay) |
| `GET /api/quests` / `POST /api/quests` | Today's quest board / claim a reward |
| `GET /api/badges` | Badge wall (awards new milestones on read) |
| `POST /api/coins/claim` | Claim 500 daily coins |
| `POST /api/slips` / `GET /api/slips` | Place bet slips / list + settle them |
| `POST /api/slips/cashout` | Cash an open slip out at current value |
| `POST /api/rooms` / `GET /api/rooms` | Create/join rooms / list mine |
| `GET /api/rooms/{code}` | Room standings by profit since joining |
| `GET /api/leaderboard` | Top 20 players by coin bankroll |
| `POST /api/player` | Upsert player by wallet/nickname |
| `GET /api/test` | End-to-end TxLINE health check |

## Stack notes

- Styling: Fey design system tokens (via the refero-ui-styles workflow),
  one typeface (Inter Tight), matte-on-matte dark surfaces, no shadows.
- Probability bar palette validated for colorblind safety and contrast.
- `scripts/setup-txline.ts` handles Token-2022 mints and SSE responses.
