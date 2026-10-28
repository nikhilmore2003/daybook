-- Daybook database setup. Paste this whole file into Supabase → SQL Editor → Run.

-- One table holds everything: each row is one "document" for one user.
--   key = 'settings'       → your habit list
--   key = 'jobs'           → your job applications
--   key = 'd-2026-10-28'   → one day: habits ticked, mood, energy, productivity, sleep, journal, time blocks
create table if not exists public.entries (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  key        text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Let signed-in users reach the table through the API (needed when
-- "Automatically expose new tables" is turned off). Logged-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.entries to authenticated;
revoke all on public.entries from anon;

-- Row Level Security: every user can only see and change their own rows.
alter table public.entries enable row level security;

drop policy if exists "Read own entries"   on public.entries;
drop policy if exists "Insert own entries" on public.entries;
drop policy if exists "Update own entries" on public.entries;
drop policy if exists "Delete own entries" on public.entries;

create policy "Read own entries"   on public.entries for select using (auth.uid() = user_id);
create policy "Insert own entries" on public.entries for insert with check (auth.uid() = user_id);
create policy "Update own entries" on public.entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own entries" on public.entries for delete using (auth.uid() = user_id);

-- Handy for your own SQL analysis later, e.g.:
--   select key, (data->>'mood')::int as mood, (data->>'sleep')::numeric as sleep
--   from entries where key like 'd-%' order by key;
