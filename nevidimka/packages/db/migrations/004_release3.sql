-- Release 3: text publication pipeline (PROJECT_SPEC.md section 7-8).
-- content_versions is append-only by design: it is the record of exactly
-- what the user saw at each pipeline step, most importantly the 'final'
-- step immediately before they pressed "Опубликовать". Nothing here is
-- ever updated in place, only inserted.

create table if not exists content_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_evidence_id uuid references evidences(id) on delete set null,
  source_text text not null, -- the raw input the pipeline started from
  status text not null default 'draft'
    check (status in (
      'draft',            -- created, not yet edited
      'editing',          -- text_editor is generating/has generated versions
      'ready_for_review', -- versions + privacy check available, awaiting user choice
      'confirmed',        -- user picked/edited a final version and confirmed it
      'publishing',       -- publish in flight
      'published',
      'failed'
    )),
  chosen_version_id uuid, -- FK added below, after content_versions exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_drafts_user on content_drafts(user_id, created_at desc);

create table if not exists content_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references content_drafts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- 'original' | 'gentle' | 'structured' | 'short' | 'final'
  step text not null check (step in ('original', 'gentle', 'structured', 'short', 'final')),
  text text not null,
  -- privacy_guard output attached to this specific version, if it was checked
  privacy_flags jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_content_versions_draft on content_versions(draft_id, created_at asc);

alter table content_drafts
  add constraint fk_content_drafts_chosen_version
  foreign key (chosen_version_id) references content_versions(id) on delete set null;

create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  draft_id uuid not null references content_drafts(id) on delete cascade,
  content_version_id uuid not null references content_versions(id),
  channel_id text not null,
  telegram_message_id bigint,
  published_html text not null, -- exact snapshot that was sent
  status text not null default 'pending'
    check (status in ('pending', 'published', 'edited', 'deleted', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_publications_user on publications(user_id, created_at desc);
create index if not exists idx_publications_draft on publications(draft_id);

-- Idempotency guard: a draft can only ever have one non-failed publication
-- attempt recorded as 'published' — prevents accidental duplicate posts if
-- a client retries a slow request (PROJECT_SPEC.md: "защита от дублей").
create unique index if not exists uq_publications_draft_published
  on publications(draft_id) where status = 'published';

alter table content_drafts enable row level security;
alter table content_versions enable row level security;
alter table publications enable row level security;

create policy content_drafts_owner on content_drafts
  using (user_id = current_setting('app.current_user_id', true)::uuid);
create policy content_versions_owner on content_versions
  using (user_id = current_setting('app.current_user_id', true)::uuid);
create policy publications_owner on publications
  using (user_id = current_setting('app.current_user_id', true)::uuid);
