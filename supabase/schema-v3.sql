-- GetIN!!! schema v3: coin economy + bet slips.
-- Run once in the Supabase SQL editor (after schema.sql and schema-v2.sql).

-- Every player starts with 1,000 coins and can claim 500 daily.
alter table public.players
  add column if not exists coins bigint not null default 1000,
  add column if not exists last_claim timestamptz;

-- A slip is one bet: a single (1 leg) or an accumulator (n legs, possibly
-- spanning matches). Combined odds = product of leg odds.
create table if not exists public.bet_slips (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references public.players (id) on delete cascade,
  stake bigint not null check (stake > 0),
  combined_odds numeric not null,
  potential_return numeric not null,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'void')),
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.bet_legs (
  id uuid primary key default gen_random_uuid(),
  slip uuid not null references public.bet_slips (id) on delete cascade,
  match_id text not null,          -- fixtureId for live, replay session id for replays
  fixture_id integer not null,
  session text,                    -- replay session (null = live)
  market_key text not null,        -- real TxLINE key: SuperOddsType|Period|Params
  market_label text not null,
  outcome_name text not null,      -- raw PriceName: part1/draw/part2/over/under
  outcome_label text not null,
  odds numeric not null,
  result text not null default 'pending' check (result in ('pending', 'won', 'lost', 'void')),
  settled_at timestamptz
);

create index if not exists bet_legs_match_idx on public.bet_legs (match_id) where result = 'pending';
create index if not exists bet_legs_slip_idx on public.bet_legs (slip);
create index if not exists bet_slips_player_idx on public.bet_slips (player);

-- Service-role only, like everything else.
alter table public.bet_slips enable row level security;
alter table public.bet_legs enable row level security;
