-- Reverses 002_rls.sql: drops policies and disables RLS, leaving the
-- tables (and their data) untouched. Safe to run independently of
-- 001's down migration.

drop policy if exists users_self on users;
drop policy if exists missions_owner on missions;
drop policy if exists milestones_owner on milestones;
drop policy if exists daily_plans_owner on daily_plans;
drop policy if exists tasks_owner on tasks;
drop policy if exists focus_sessions_owner on focus_sessions;
drop policy if exists evidences_owner on evidences;
drop policy if exists ideas_owner on ideas;
drop policy if exists ai_logs_owner on ai_logs;
drop policy if exists privacy_flags_owner on privacy_flags;

alter table users disable row level security;
alter table missions disable row level security;
alter table milestones disable row level security;
alter table daily_plans disable row level security;
alter table tasks disable row level security;
alter table focus_sessions disable row level security;
alter table evidences disable row level security;
alter table ideas disable row level security;
alter table ai_logs disable row level security;
alter table privacy_flags disable row level security;
