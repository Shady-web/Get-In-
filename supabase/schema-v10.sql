-- GetIN!!! schema v10: coins start at zero, no daily claim.
-- Run once in the Supabase SQL editor (after schema-v9.sql).

-- New players start with 0 coins (earn them from quests and winning bets).
alter table public.players
  alter column coin_balance set default 0;
