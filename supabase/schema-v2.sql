-- GetIN!!! schema v2: prediction game + realtime leaderboard.
-- Run this once in the Supabase SQL editor (after schema.sql).

-- Players: track the running streak (best_streak already exists).
alter table public.players
  add column if not exists current_streak integer not null default 0;

-- Predictions: one pick per player per ROUND (not per match anymore),
-- plus the context settlement needs.
alter table public.predictions
  drop constraint if exists predictions_player_match_id_key;

alter table public.predictions
  add column if not exists round integer not null default 0,
  add column if not exists kind text,
  add column if not exists question text,
  add column if not exists baseline jsonb,
  add column if not exists settled_at timestamptz;

create unique index if not exists predictions_player_match_round_key
  on public.predictions (player, match_id, round);

-- Realtime leaderboard: the browser may READ players (nickname + points are
-- public game data) via the anon key; all writes stay service-role only.
drop policy if exists players_public_read on public.players;
create policy players_public_read
  on public.players for select
  to anon, authenticated
  using (true);

-- Broadcast player changes so leaderboards update live.
-- (Wrapped so re-running this file doesn't error if already added.)
do $$
begin
  alter publication supabase_realtime add table public.players;
exception
  when duplicate_object then null;
end $$;
