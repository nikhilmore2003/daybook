-- Daybook v5: reply to feedback and notify the member once.
-- Run in Supabase → SQL Editor after schema_v4.sql. Safe to run more than once.

alter table public.feedback add column if not exists reply      text;
alter table public.feedback add column if not exists replied_at timestamptz;
alter table public.feedback add column if not exists seen_at    timestamptz;

-- A member marks their own update as seen (they can't edit anything else on the row).
create or replace function public.mark_feedback_seen(fid bigint) returns void
language sql security definer set search_path = public as $$
  update public.feedback set seen_at = now()
  where id = fid and user_id = auth.uid() and seen_at is null;
$$;
revoke execute on function public.mark_feedback_seen(bigint) from public, anon;
grant execute on function public.mark_feedback_seen(bigint) to authenticated;

notify pgrst, 'reload schema';
