-- GetIN!!! schema v4: cash out.
-- Run once in the Supabase SQL editor (after schema-v3.sql).

alter table public.bet_slips
  drop constraint if exists bet_slips_status_check;
alter table public.bet_slips
  add constraint bet_slips_status_check
  check (status in ('pending', 'won', 'lost', 'void', 'cashed'));

-- What the player actually received when cashing out early.
alter table public.bet_slips
  add column if not exists cashout_amount bigint;
