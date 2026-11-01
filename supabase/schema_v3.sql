-- Daybook v3: datasets + Run/auto-check for daily practice.
-- Run in Supabase → SQL Editor after schema_v2.sql. Safe to run more than once.

-- Each question can carry its dataset, the cell to answer (Excel) and a checker
-- (the reference formula / query / code the app runs to know the correct output).
alter table public.questions add column if not exists data jsonb;
alter table public.questions add column if not exists answer_cell text;
alter table public.questions add column if not exists checker text;

-- Whether the submitted answer matched the expected output when it was run.
alter table public.submissions add column if not exists correct boolean;

-- Solvers list now also says who got it right.
drop function if exists public.daily_solvers(date);
create function public.daily_solvers(p_day date)
returns table (question_id bigint, user_id uuid, display_name text, solved_at timestamptz, correct boolean)
language sql stable security definer set search_path = public as $$
  select s.question_id, s.user_id, coalesce(m.display_name, 'Member'), s.created_at, s.correct
  from public.submissions s
  join public.questions q on q.id = s.question_id
  left join public.members m on m.user_id = s.user_id
  where q.day = p_day and auth.uid() is not null
  order by s.created_at;
$$;
revoke execute on function public.daily_solvers(date) from public, anon;
grant execute on function public.daily_solvers(date) to authenticated;
