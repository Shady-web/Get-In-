-- GetIN!!! schema v9: bet in devnet SOL as well as coins.
-- Run once in the Supabase SQL editor (after schema-v8.sql).

-- Slips now carry the currency they were staked in. COIN stakes/returns are
-- whole coins; SOL stakes/returns are lamports (1 SOL = 1e9 lamports).
alter table public.bet_slips
  add column if not exists currency text not null default 'COIN'
    check (currency in ('COIN', 'SOL'));

-- Track the last on-chain balance we credited, so a faucet deposit is added
-- to the spendable sol_balance exactly once (deposits raise the balance; we
-- never withdraw, so on-chain only moves up).
alter table public.players
  add column if not exists sol_seen bigint not null default 0;
