-- OPTIONAL: create the daily questions automatically at 00:05 India time,
-- so the first person each morning doesn't wait. Run once in Supabase → SQL Editor.
-- It also pings your project every day, which helps keep the free project from pausing.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('daybook-daily-questions')
where exists (select 1 from cron.job where jobname = 'daybook-daily-questions');

select cron.schedule(
  'daybook-daily-questions',
  '35 18 * * *',   -- 18:35 UTC = 00:05 IST
  $$
  select net.http_post(
    url := 'https://yfkoedftesywkhppmmjs.supabase.co/functions/v1/daily-questions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlma29lZGZ0ZXN5d2tocHBtbWpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMDE5NjQsImV4cCI6MjEwODc3Nzk2NH0.kJWV1mnYnE7yzD7smSqCUy2c4tJc1SP9lFm_hWMo1v4"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
