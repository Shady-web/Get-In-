-- GetIN!!! schema — run this once in the Supabase SQL editor.
--
-- No Supabase Auth: identity is just a wallet address or nickname, and ALL
-- database access goes through our Next.js API routes using the service-role
-- key. RLS is enabled with no policies, so the anon/public key can't touch
-- these tables at all.

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  wallet_or_nickname text not null unique,
  total_points integer not null default 0,
  best_streak integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references public.players (id) on delete cascade,
  match_id text not null,
  choice text not null,             -- e.g. 'home' | 'draw' | 'away'
  odds_at_pick numeric,             -- decimal odds when the pick was made
  points_awarded integer,           -- null until the match is settled
  result text,                      -- null until settled, then e.g. 'won' | 'lost'
  created_at timestamptz not null default now(),
  unique (player, match_id)         -- one pick per player per match
);

create index if not exists predictions_match_id_idx on public.predictions (match_id);

-- Lock everything down: no policies means only the service role gets in.
alter table public.players enable row level security;
alter table public.predictions enable row level security;
