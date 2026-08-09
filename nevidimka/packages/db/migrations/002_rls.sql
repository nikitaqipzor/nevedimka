-- Row Level Security for Release 1 tables.
--
-- Pattern: every request-scoped DB session sets a Postgres session variable
-- `app.current_user_id` (via `select set_config('app.current_user_id', $1, true)`)
-- right after acquiring a connection, before running any query for that
-- request. All policies below check rows against that variable, so a bug
-- in application code that forgets a WHERE user_id = ... clause still can't
-- leak another user's data.
--
-- If Release 2 exposes tables directly to the Mini App via Supabase
-- PostgREST/Supabase Auth, add parallel policies keyed on auth.uid() that
-- join through a users.auth_user_id column — out of scope for Release 1,
-- where the bot is the only client and always talks through the backend
-- service layer, which uses the service role / sets app.current_user_id.

alter table users enable row level security;
alter table missions enable row level security;
alter table milestones enable row level security;
alter table daily_plans enable row level security;
alter table tasks enable row level security;
alter table focus_sessions enable row level security;
alter table evidences enable row level security;
alter table ideas enable row level security;
alter table ai_logs enable row level security;
alter table privacy_flags enable row level security;

create policy users_self on users
  using (id = current_setting('app.current_user_id', true)::uuid);

create policy missions_owner on missions
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy milestones_owner on milestones
  using (
    mission_id in (
      select id from missions
      where user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

create policy daily_plans_owner on daily_plans
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy tasks_owner on tasks
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy focus_sessions_owner on focus_sessions
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy evidences_owner on evidences
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy ideas_owner on ideas
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy ai_logs_owner on ai_logs
  using (user_id = current_setting('app.current_user_id', true)::uuid);

create policy privacy_flags_owner on privacy_flags
  using (user_id = current_setting('app.current_user_id', true)::uuid);

-- Two Postgres roles are expected in production:
--   1. A default app role (no BYPASSRLS) used for every request-scoped
--      query via withUserContext() — this is what RLS actually protects.
--   2. A narrowly-used bootstrap/admin role WITH BYPASSRLS, used only for
--      migrations and the one auth step that looks up/creates a user row
--      by telegram_id before app.current_user_id can be set
--      (withSystemContext() in packages/db/src/client.ts).
-- For local development a single BYPASSRLS role is fine; tighten this
-- before exposing the database to any client other than the trusted
-- backend (e.g. if Release 2 lets the Mini App query Postgres directly).
