-- Release 1 schema: core daily-cycle tables.
-- See PROJECT_SPEC.md section 12 for the full target data model;
-- this migration implements only the Release 1 subset.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null unique,
  username text,
  first_name text,
  day0_date date not null default current_date,
  program_length smallint not null default 180 check (program_length in (180, 365)),
  timezone text not null default 'Europe/Amsterdam',
  reminder_hour_morning smallint check (reminder_hour_morning between 0 and 23),
  reminder_hour_evening smallint check (reminder_hour_evening between 0 and 23),
  created_at timestamptz not null default now()
);

create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  description text,
  directions text[] not null default '{}',
  commitment_text text not null default '',
  status text not null default 'active' check (status in ('draft','active','completed','abandoned')),
  created_at timestamptz not null default now()
);
create index if not exists idx_missions_user on missions(user_id);

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  title text not null,
  target_day int not null,
  status text not null default 'planned' check (status in ('planned','in_progress','done','skipped')),
  created_at timestamptz not null default now()
);
create index if not exists idx_milestones_mission on milestones(mission_id);

create table if not exists daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  day_number int not null,
  sleep_quality smallint check (sleep_quality between 1 and 5),
  energy smallint check (energy between 1 and 5),
  mood smallint check (mood between 1 and 5),
  stress smallint check (stress between 1 and 5),
  check_in_note text,
  main_task_id uuid, -- FK added after tasks table exists
  ai_summary text,
  evening_review_note text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists idx_daily_plans_user_date on daily_plans(user_id, date);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  mission_id uuid references missions(id) on delete set null,
  daily_plan_id uuid references daily_plans(id) on delete set null,
  title text not null,
  is_main_task boolean not null default false,
  status text not null default 'planned'
    check (status in ('planned','in_progress','done','partially_done','postponed','cancelled')),
  estimate_minutes int,
  actual_minutes int,
  completion_percent smallint check (completion_percent between 0 and 100),
  postponed_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_user on tasks(user_id);
create index if not exists idx_tasks_daily_plan on tasks(daily_plan_id);

alter table daily_plans
  add constraint fk_daily_plans_main_task
  foreign key (main_task_id) references tasks(id) on delete set null;

create table if not exists focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int,
  was_interrupted boolean not null default false
);
create index if not exists idx_focus_sessions_user on focus_sessions(user_id);

create table if not exists evidences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  kind text not null check (kind in ('text','voice','video')),
  storage_path text,
  transcript text,
  raw_text text,
  created_at timestamptz not null default now()
);
create index if not exists idx_evidences_user on evidences(user_id);

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  status text not null default 'inbox' check (status in ('inbox','converted_to_task','archived')),
  created_at timestamptz not null default now()
);
create index if not exists idx_ideas_user on ideas(user_id);

create table if not exists ai_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  input jsonb not null,
  output jsonb,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(10,4),
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_logs_user on ai_logs(user_id, created_at desc);

-- privacy_flags: lets the user exclude a specific record from AI context
-- without deleting it (PROJECT_SPEC.md section 15).
create table if not exists privacy_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entity_type text not null, -- 'evidence' | 'journal_entry' | 'idea' | ...
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);
