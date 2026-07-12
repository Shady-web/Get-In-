-- GetIN!!! schema v11: the house pool.
-- Run once in the Supabase SQL editor (after schema-v10.sql).
--
-- A single-row accounting of the house's net devnet-SOL position from betting
-- and airdrops, in lamports. LOSING SOL stakes feed it (the stake is taken at
-- placement and kept on a loss); winning payouts, void refunds, cash-outs and
-- airdrops draw it down. This is what gives the book an edge - losers fund
-- winners - rather than the house covering every payout on its own.
--
-- Optional: the app treats house-pool updates as best-effort, so it keeps
-- working even before this table exists (pool tracking is simply skipped).

create table if not exists public.house_pool (
  id smallint primary key default 1,
  lamports bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint house_pool_singleton check (id = 1)
);

insert into public.house_pool (id, lamports)
  values (1, 0)
  on conflict (id) do nothing;

-- Service-role only, like everything else.
alter table public.house_pool enable row level security;
