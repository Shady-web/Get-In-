# GetIN!!!

A mobile-first (and desktop-friendly) World Cup live prediction game.
Watch live matches, call what happens next before it happens, earn points
scaled by the real odds, build streaks, and climb a global leaderboard.
Finished matches can be replayed on a timeline and played like they're live.

Built for a World Cup hackathon with **Next.js (App Router) + TypeScript +
Supabase + Vercel**, on live data from the **TxLINE** sports API (free
on-chain World Cup tier, Solana).

## How it works

- **Accounts**: Supabase Auth with email/password or Google sign-in. The
  login form takes an email OR a username (usernames map to their email
  server-side). A player is keyed to their Supabase auth user id.
- **Custodial devnet wallet**: on first login the backend generates a
  Solana devnet keypair for the user, stored server-side only. We never
  fund it: new wallets start at 0 and players deposit free test SOL from
  the public faucet via the Wallet tab. Balances show in SOL and USD at a
  hard-coded 1 SOL = $150, and every money movement lands in a ledger
  table. A sitewide banner marks everything as devnet test tokens.
- **Live matches**: score, match clock, and a win-probability bar derived
  from the TxLINE 1X2 market (margin normalized away), updating every ~7s.
- **The game**: every minute of match time deals a prediction card
  (full-time result, goal-before-minute-X, corner-before-minute-X).
  Points = round(odds x 10), so unlikely calls pay more. Picks store the
  odds snapshot; settlement is automatic (correct picks add points and
  extend your streak, a miss resets it to 0).
- **Replay Mode**: just-finished matches replay on a timeline (scrubber,
  x1/x10/x60 speed) from full time until about 2 hours after. Cards price
  from the odds as they stood at that moment; scoring works exactly like
  live.
- **Coin economy + SOL betting**: every player starts at 0 coins and earns
  them from daily quests and winning bets (no daily handout). Tap any
  full-time price (Markets tab, or the winner odds in a replay) to build a
  Bet Slip: one selection = single, several (across matches) = accumulator
  at the product of leg odds. Stake in **coins or devnet SOL** (toggle on
  the slip); SOL stakes and payouts move the custodial balance you funded
  from the faucet, tracked in lamports. Slips settle automatically from the
  scores data - in live matches and in Replay Mode. Open slips show a live
  Cash Out value (potential return x current implied probability of the
  pending legs x 0.95) that animates as odds move.
- **Wallet (Deposit + Withdraw)**: one Wallet tab with the balance pinned
  on top and a Deposit / Withdraw toggle so the two flows never crowd each
  other. Fund the custodial devnet wallet from the public faucet, and
  withdraw devnet SOL to any external address (min 0.0067 SOL). The signing
  key stays server-side.
- **Recent form**: open any match to see each team's last 3 results
  (W/D/L, scores, opponents) before you predict. Assembled from the
  fixtures schedule + final scores; hides itself when there's no history.
- **My Bets**: open and settled bets in separate sections, with a counter
  badge on the tab for how many are still running and per-leg won/lost/
  pending status on every accumulator.
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
- **Leaderboard**: global top 20 ranked by coin bankroll, live via Supabase
  Realtime (or polling fallback), plus a downloadable streak share card.

## Security model

- TxLINE tokens live ONLY on the server (`.env.local` / Vercel env vars).
  The browser talks to our own `/api/*` routes; those routes talk to TxLINE.
- Identity is the Supabase Auth user: the browser sends its session token
  and every protected route verifies it server-side (`lib/auth.ts`).
  Clients can no longer pick their own identity string.
- Custodial wallet secret keys live in a service-role-only table and never
  leave the server; API responses carry the public address only.
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
8. `supabase/schema-v8.sql`
9. `supabase/schema-v9.sql`
10. `supabase/schema-v10.sql`

Then enable the auth providers: Dashboard -> Authentication -> Providers ->
turn on **Email** (password sign-in) and **Google** (paste a Google OAuth
client id/secret from console.cloud.google.com).

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

# REQUIRED for sign-in (public anon key is browser-safe)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Optional: custom devnet RPC for wallet balances (default: public devnet)
# SOLANA_RPC_URL=

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
| `GET /api/stats/{fixtureId}` | Recent form (last 3 results) for both teams |
| `GET /api/quests` / `POST /api/quests` | Today's quest board / claim a reward |
| `GET /api/badges` | Badge wall (awards new milestones on read) |
| `GET /api/wallet` / `POST /api/wallet/withdraw` | Balance + address / withdraw SOL |
| `POST /api/slips` / `GET /api/slips` | Place bet slips / list + settle them |
| `POST /api/slips/cashout` | Cash an open slip out at current value |
| `GET /api/wallet` | Custodial devnet address + SOL/USD balance |
| `POST /api/auth/register` | Sign-up (email + username + password) |
| `POST /api/auth/lookup` | Username -> email for the combined login field |
| `POST /api/rooms` / `GET /api/rooms` | Create/join rooms / list mine |
| `GET /api/rooms/{code}` | Room standings by profit since joining |
| `GET /api/leaderboard` | Top 20 players by coin bankroll |
| `POST /api/player` | Bootstrap player + wallet for the signed-in user |
| `GET /api/test` | End-to-end TxLINE health check |

## Stack notes

- Styling: the GetIN design system (stadium night). Floodlit pitch green +
  electric-lime CTAs + trophy-gold GI coins on a deep green-black canvas.
  Anton for display (scores, streaks, headings), Space Mono for every
  number (odds, coins, stakes, clock), Archivo for body.
- Coin economy rule: GI-coin calls ride to full time and settle
  automatically (no early cash out); only SOL calls can be cashed out
  early. An in-app "How GetIN works" explainer (first visit + the coin
  pill in the header) documents this.
- Probability bar palette validated for colorblind safety and contrast.
- `scripts/setup-txline.ts` handles Token-2022 mints and SSE responses.
