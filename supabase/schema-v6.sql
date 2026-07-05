-- GetIN!!! schema v6: Pundit ticker takes.
-- Run once in the Supabase SQL editor (after schema-v5.sql).

-- One row per (fixture, event): the cache that guarantees a replayed match
-- never re-calls the AI for a take it already generated. event_key is
-- deterministic (e.g. "goal:2-1", "red:home:1", "swing:home:44-62") so live
-- and replay derivations land on the same rows.
create table if not exists public.pundit_takes (
  id uuid primary key default gen_random_uuid(),
  fixture_id bigint not null,
  event_key text not null,
  kind text not null,               -- goal | red | swing
  minute int not null,              -- match minute (0 = pre-match)
  take text not null,               -- the one-liner
  created_at timestamptz not null default now(),
  unique (fixture_id, event_key)
);

create index if not exists pundit_takes_fixture_idx
  on public.pundit_takes (fixture_id);

-- Service-role only, like everything else: reads go through our API.
alter table public.pundit_takes enable row level security;
