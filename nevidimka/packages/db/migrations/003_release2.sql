-- Release 2 additions. Release 1's schema (001_init.sql) is untouched —
-- this only adds what the Mini App's "Путь"/"Карта навыков" screens need.

alter table tasks
  add column if not exists direction text; -- one of missions.directions, or null

create index if not exists idx_tasks_user_direction on tasks(user_id, direction)
  where direction is not null;

-- Evidence-as-journal feed benefits from a covering created_at index for
-- pagination (see packages/db/src/repository.ts: listEvidencesForUser).
create index if not exists idx_evidences_user_created on evidences(user_id, created_at desc);

-- Persisted chat history for the Mini App's "AI-наставник" screen
-- (PROJECT_SPEC.md section 11: "чат с оркестратором, история рекомендаций").
create table if not exists mentor_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_mentor_messages_user on mentor_messages(user_id, created_at);

alter table mentor_messages enable row level security;
create policy mentor_messages_owner on mentor_messages
  using (user_id = current_setting('app.current_user_id', true)::uuid);
