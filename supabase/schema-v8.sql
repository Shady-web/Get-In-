-- GetIN!!! schema v8: Supabase Auth identity + Solana devnet money foundation.
-- Run once in the Supabase SQL editor (after schema-v7.sql).
--
-- Also enable the auth providers in the dashboard:
--   Authentication -> Providers -> Email (on) and Google (paste OAuth creds).

-- Players are now keyed to the Supabase Auth user. username doubles as the
-- login alias and the display name (wallet_or_nickname mirrors it so every
-- existing leaderboard/rooms display keeps working).
alter table public.players
  add column if not exists auth_user_id uuid unique,
  add column if not exists username text unique,
  add column if not exists sol_balance bigint not null default 0,   -- lamports
  add column if not exists coin_balance bigint not null default 1000;

-- Carry existing bankrolls over from the old coins column.
update public.players set coin_balance = coins
  where coins is not null and coin_balance = 1000;

-- Custodial devnet wallets: ONE per player, generated server-side on first
-- login, NEVER funded by us (new wallets start at 0) and the secret never
-- leaves the server. RLS locked; service-role only.
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  player uuid not null unique references public.players (id) on delete cascade,
  pubkey text not null unique,
  secret text not null,             -- JSON secret key bytes; server-side only
  created_at timestamptz not null default now()
);

-- Money movements, both currencies. amount_lamports holds lamports for SOL
-- rows and whole coins for COIN rows (per the column name convention).
create table if not exists public.ledger (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references public.players (id) on delete cascade,
  type text not null,               -- deposit_check | bet_stake | bet_payout |
                                    -- cashout | daily_claim | quest_reward | ...
  amount_lamports bigint not null,  -- signed: positive = credit
  currency text not null check (currency in ('SOL', 'COIN')),
  ref text,                         -- slip id, quest id, pubkey, ...
  created_at timestamptz not null default now()
);

create index if not exists ledger_player_idx
  on public.ledger (player, created_at desc);

alter table public.wallets enable row level security;
alter table public.ledger enable row level security;
