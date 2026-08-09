-- Reverses 001_init.sql. Drops every Release 1 table. Does NOT drop the
-- pgcrypto extension, since other databases on the same Postgres instance
-- may depend on it — extensions are left alone by convention here.

drop table if exists privacy_flags;
drop table if exists ai_logs;
drop table if exists ideas;
drop table if exists evidences;
drop table if exists focus_sessions;
alter table if exists daily_plans drop constraint if exists fk_daily_plans_main_task;
drop table if exists tasks;
drop table if exists daily_plans;
drop table if exists milestones;
drop table if exists missions;
drop table if exists users;
