-- Enables multiple simultaneously-active missions per user.
-- See docs/superpowers/specs/2026-08-09-multi-active-goals-design.md

-- 1. Drop the one-active-mission invariant from 008.
drop index if exists uq_missions_one_active_per_user;

-- 2. Add 'paused' status ("отложить"), distinct from 'abandoned'.
alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check
  check (status in ('draft', 'active', 'completed', 'abandoned', 'paused'));

-- 3. Move day0_date / program_length onto missions (per-goal, not account-wide).
alter table missions add column if not exists day0_date date;
alter table missions add column if not exists program_length smallint check (program_length in (180, 365));

-- Backfill: every existing mission inherits its owner's current values.
update missions m
set day0_date = u.day0_date,
    program_length = u.program_length
from users u
where m.user_id = u.id;

-- NOTE: the two `set not null` calls below each take an ACCESS EXCLUSIVE
-- lock on missions for a full table scan/verification pass (Postgres < 12
-- semantics; even on newer versions the lock itself is still ACCESS
-- EXCLUSIVE, only the scan may be skipped when a matching check constraint
-- already exists). On a non-trivial production missions table, run this
-- migration during a maintenance window.
alter table missions alter column day0_date set not null;
alter table missions alter column day0_date set default current_date;
alter table missions alter column program_length set not null;
alter table missions alter column program_length set default 180;

-- users.day0_date / users.program_length are no longer read once this ships
-- (see Tasks 8-16). Dropped here per repo convention of not leaving dead
-- columns that could silently diverge from the per-mission source of truth.
alter table users drop column if exists day0_date;
alter table users drop column if exists program_length;

-- 4. Race-safe cap enforcement.
-- max_active below must be kept in sync by hand with
-- MAX_ACTIVE_MISSIONS in packages/shared-types/src/index.ts (Task 3) —
-- triggers can't import a TS constant.
-- A plain COUNT(*) inside a BEFORE trigger is not a hard guarantee under
-- READ COMMITTED: two concurrent inserts for the same user can each see a
-- pre-cap count and both pass. Serialize with an advisory xact lock on the
-- user_id before counting.
create or replace function enforce_active_mission_limit()
returns trigger as $$
declare
  active_count integer;
  max_active constant integer := 5;
begin
  if new.status = 'active' then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));

    select count(*) into active_count
    from missions
    where user_id = new.user_id
      and status = 'active'
      and id is distinct from new.id;

    if active_count >= max_active then
      raise exception 'active mission cap (%) exceeded for user %', max_active, new.user_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_active_mission_limit on missions;
create trigger trg_enforce_active_mission_limit
  before insert or update on missions
  for each row
  execute function enforce_active_mission_limit();
