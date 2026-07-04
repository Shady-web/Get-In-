-- GetIN!!! schema v5: private rooms.
-- Run once in the Supabase SQL editor (after schema-v4.sql).

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,        -- 6-char join code
  name text not null,
  created_by uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room uuid not null references public.rooms (id) on delete cascade,
  player uuid not null references public.players (id) on delete cascade,
  baseline_coins bigint not null,   -- bankroll when they joined: profit = coins - baseline
  joined_at timestamptz not null default now(),
  unique (room, player)
);

create index if not exists room_members_room_idx on public.room_members (room);
create index if not exists room_members_player_idx on public.room_members (player);

-- Service-role only, like everything else (reads go through our API; the
-- realtime trigger rides the existing players publication).
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
