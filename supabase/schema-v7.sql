-- GetIN!!! schema v7: daily quests + badges.
-- Run once in the Supabase SQL editor (after schema-v6.sql).

-- One row per claimed quest reward. The unique constraint is what makes a
-- quest claimable exactly once per player per day; the day's quest rotation
-- itself is deterministic from the date (no cron, nothing stored).
create table if not exists public.quest_claims (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references public.players (id) on delete cascade,
  quest_id text not null,
  day date not null,                -- UTC day the quest belonged to
  reward bigint not null,           -- coins paid, kept for history
  claimed_at timestamptz not null default now(),
  unique (player, quest_id, day)
);

create index if not exists quest_claims_player_day_idx
  on public.quest_claims (player, day);

-- Milestone badges, awarded once and kept forever.
create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references public.players (id) on delete cascade,
  badge_id text not null,
  earned_at timestamptz not null default now(),
  unique (player, badge_id)
);

create index if not exists badges_player_idx on public.badges (player);

-- Service-role only, like everything else.
alter table public.quest_claims enable row level security;
alter table public.badges enable row level security;
