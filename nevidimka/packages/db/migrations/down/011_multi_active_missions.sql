-- Reverses 011_multi_active_missions.sql.
-- CAVEAT: if any user has more than one mission, or their only missions are
-- not 'active', this collapses back to one row per user using the most
-- recently created mission regardless of status (best-effort, not lossless
-- — multi-active-goal state cannot be represented on a single-row users
-- table). Documented here rather than silently defaulting.
drop trigger if exists trg_enforce_active_mission_limit on missions;
drop function if exists enforce_active_mission_limit();

alter table users add column day0_date date not null default current_date;
alter table users add column program_length smallint not null default 180
  check (program_length in (180, 365));

update users u
set day0_date = latest.day0_date,
    program_length = latest.program_length
from (
  select distinct on (user_id) user_id, day0_date, program_length
  from missions
  order by user_id, created_at desc
) latest
where latest.user_id = u.id;

alter table missions drop column if exists day0_date;
alter table missions drop column if exists program_length;

alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check
  check (status in ('draft', 'active', 'completed', 'abandoned'));

create unique index if not exists uq_missions_one_active_per_user
  on missions(user_id) where status = 'active';
