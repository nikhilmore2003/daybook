-- Daybook v2: community, daily AI questions, admin page.
-- Run this in Supabase → SQL Editor AFTER schema.sql. Safe to run more than once.

-- =========================================================
-- Admins (only editable from the SQL Editor, never from the app)
-- =========================================================
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "See own admin row" on public.admins;
create policy "See own admin row" on public.admins for select to authenticated using (auth.uid() = user_id);
grant select on public.admins to authenticated;
revoke all on public.admins from anon;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- =========================================================
-- Members: each person's public community profile
-- =========================================================
create table if not exists public.members (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  streak       int  not null default 0,
  best_streak  int  not null default 0,
  solved_total int  not null default 0,
  practice_7d  int  not null default 0,
  tasks_7d     int  not null default 0,
  applications jsonb not null default '[]'::jsonb,
  last_active  date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.members enable row level security;
drop policy if exists "Members visible to signed-in users" on public.members;
drop policy if exists "Insert own member row" on public.members;
drop policy if exists "Update own member row" on public.members;
drop policy if exists "Delete own member row" on public.members;
create policy "Members visible to signed-in users" on public.members for select to authenticated using (true);
create policy "Insert own member row" on public.members for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own member row" on public.members for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own member row" on public.members for delete to authenticated using (auth.uid() = user_id);
grant select, insert, update, delete on public.members to authenticated;
revoke all on public.members from anon;

-- =========================================================
-- Daily questions (written by the daily-questions Edge Function)
-- =========================================================
create table if not exists public.daily_sets (
  day        date primary key,
  status     text not null default 'generating',   -- generating | ready | partial | failed
  started_at timestamptz not null default now(),
  error      text
);

create table if not exists public.questions (
  id       bigint generated always as identity primary key,
  day      date not null references public.daily_sets(day) on delete cascade,
  subject  text not null,
  level    text not null check (level in ('easy','medium','hard')),
  topic    text,
  title    text not null,
  prompt   text not null,
  position int  not null default 0
);
create index if not exists questions_day_idx on public.questions(day);

create table if not exists public.solutions (
  question_id bigint primary key references public.questions(id) on delete cascade,
  solution    text not null
);

create table if not exists public.submissions (
  id          bigint generated always as identity primary key,
  question_id bigint not null references public.questions(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  answer      text not null check (char_length(answer) between 1 and 8000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (question_id, user_id)
);
create index if not exists submissions_q_idx on public.submissions(question_id);
create index if not exists submissions_u_idx on public.submissions(user_id);

alter table public.daily_sets  enable row level security;
alter table public.questions   enable row level security;
alter table public.solutions   enable row level security;
alter table public.submissions enable row level security;

-- Has the current user answered this question? (bypasses RLS to avoid recursion)
create or replace function public.has_submitted(q bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.submissions where question_id = q and user_id = auth.uid());
$$;
revoke execute on function public.has_submitted(bigint) from public, anon;
grant execute on function public.has_submitted(bigint) to authenticated;

drop policy if exists "Read daily sets" on public.daily_sets;
drop policy if exists "Read questions" on public.questions;
drop policy if exists "Read solution after answering" on public.solutions;
drop policy if exists "Read answers after answering" on public.submissions;
drop policy if exists "Insert own answer" on public.submissions;
drop policy if exists "Update own answer" on public.submissions;
drop policy if exists "Delete own answer" on public.submissions;

create policy "Read daily sets" on public.daily_sets for select to authenticated using (true);
create policy "Read questions"  on public.questions  for select to authenticated using (true);
-- Model answer and other people's answers unlock only after you submit your own.
create policy "Read solution after answering" on public.solutions for select to authenticated
  using (public.has_submitted(question_id) or public.is_admin());
create policy "Read answers after answering" on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.has_submitted(question_id) or public.is_admin());
create policy "Insert own answer" on public.submissions for insert to authenticated with check (user_id = auth.uid());
create policy "Update own answer" on public.submissions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Delete own answer" on public.submissions for delete to authenticated using (user_id = auth.uid());

grant select on public.daily_sets, public.questions, public.solutions to authenticated;
grant select, insert, update, delete on public.submissions to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.daily_sets, public.questions, public.solutions, public.submissions from anon;
-- The daily-questions Edge Function writes with the service role. Needed when
-- "Automatically expose new tables" is off.
grant select, insert, update, delete on public.daily_sets, public.questions, public.solutions, public.submissions, public.members, public.admins to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Who solved what on a day: names only, never answers. Everyone signed in can see it.
create or replace function public.daily_solvers(p_day date)
returns table (question_id bigint, user_id uuid, display_name text, solved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.question_id, s.user_id, coalesce(m.display_name, 'Member'), s.created_at
  from public.submissions s
  join public.questions q on q.id = s.question_id
  left join public.members m on m.user_id = s.user_id
  where q.day = p_day and auth.uid() is not null
  order by s.created_at;
$$;
revoke execute on function public.daily_solvers(date) from public, anon;
grant execute on function public.daily_solvers(date) to authenticated;

-- Admin page: every account with email and activity. Passwords are never readable.
create or replace function public.admin_members()
returns table (user_id uuid, email text, display_name text, joined timestamptz, last_sign_in timestamptz,
               streak int, solved_total int, practice_7d int, applications int, last_active date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
    select u.id, u.email::text, m.display_name, u.created_at, u.last_sign_in_at,
           coalesce(m.streak, 0), coalesce(m.solved_total, 0), coalesce(m.practice_7d, 0),
           coalesce(jsonb_array_length(m.applications), 0), m.last_active
    from auth.users u
    left join public.members m on m.user_id = u.id
    order by u.created_at desc;
end $$;
revoke execute on function public.admin_members() from public, anon;
grant execute on function public.admin_members() to authenticated;

-- =========================================================
-- Make yourself admin: put the email you log in to Daybook with, then run this line.
-- =========================================================
-- insert into public.admins (user_id) select id from auth.users where email = 'YOUR-EMAIL@gmail.com' on conflict do nothing;
