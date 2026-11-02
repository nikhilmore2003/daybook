-- Daybook v4: in-app feedback.
-- Run in Supabase → SQL Editor. Safe to run more than once.

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  name       text,
  email      text,
  kind       text not null default 'idea' check (kind in ('idea','bug','like','other')),
  rating     int check (rating between 1 and 5),
  message    text not null check (char_length(btrim(message)) between 1 and 2000),
  page       text,
  status     text not null default 'new' check (status in ('new','done')),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;

drop policy if exists "Send own feedback" on public.feedback;
drop policy if exists "Read own feedback or admin" on public.feedback;
drop policy if exists "Admin updates feedback" on public.feedback;
drop policy if exists "Admin deletes feedback" on public.feedback;

-- Members can send feedback and see what they sent; only admins see everyone's and mark it done.
create policy "Send own feedback" on public.feedback for insert to authenticated with check (user_id = auth.uid());
create policy "Read own feedback or admin" on public.feedback for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "Admin updates feedback" on public.feedback for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admin deletes feedback" on public.feedback for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.feedback to authenticated;
grant select, insert, update, delete on public.feedback to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.feedback from anon;

notify pgrst, 'reload schema';
