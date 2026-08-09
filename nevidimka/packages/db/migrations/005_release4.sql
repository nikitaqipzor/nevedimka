-- Release 4: video pipeline (PROJECT_SPEC.md section 9).

create table if not exists video_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_evidence_id uuid references evidences(id) on delete set null,
  original_storage_path text not null,
  duration_seconds numeric,
  width int,
  height int,
  status text not null default 'uploaded'
    check (status in (
      'uploaded',      -- received, not yet processed
      'processing',    -- pipeline running (cuts, crop, normalize, cover, preview)
      'preview_ready',
      'confirmed',      -- user confirmed the preview
      'rendering',      -- final render in progress
      'published',
      'cancelled',      -- user declined the preview — not an error
      'failed'
    )),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_video_assets_user on video_assets(user_id, created_at desc);

-- Present for completeness with the full data model (PROJECT_SPEC.md
-- section 12), but unused until a real ASR provider is wired up — see
-- packages/video/src/asr.ts. No code writes to this table yet.
create table if not exists video_transcripts (
  id uuid primary key default gen_random_uuid(),
  video_asset_id uuid not null references video_assets(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  full_text text not null,
  segments jsonb not null, -- [{start, end, text}, ...]
  created_at timestamptz not null default now()
);

create table if not exists video_cut_plans (
  id uuid primary key default gen_random_uuid(),
  video_asset_id uuid not null references video_assets(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  cuts jsonb not null, -- [{start, end, reason}, ...]
  source text not null check (source in ('silence_detection', 'ai_semantic')),
  created_at timestamptz not null default now()
);

create table if not exists video_renders (
  id uuid primary key default gen_random_uuid(),
  video_asset_id uuid not null references video_assets(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('preview', 'final')),
  storage_path text not null,
  cover_path text,
  width int,
  height int,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);
create index if not exists idx_video_renders_asset on video_renders(video_asset_id, kind);

-- Widen publications to also represent video posts. A text publication
-- still requires draft_id + content_version_id (as in Release 3); a video
-- publication requires video_asset_id + video_render_id instead. Exactly
-- one of the two pairs must be present.
alter table publications alter column draft_id drop not null;
alter table publications alter column content_version_id drop not null;
alter table publications add column if not exists video_asset_id uuid references video_assets(id);
alter table publications add column if not exists video_render_id uuid references video_renders(id);

alter table publications drop constraint if exists chk_publications_content_or_video;
alter table publications add constraint chk_publications_content_or_video
  check (
    (content_version_id is not null and video_render_id is null)
    or (content_version_id is null and video_render_id is not null)
  );

-- The Release 3 unique index assumed draft_id was always present; replace
-- it with one guard per post type so each can't be double-published.
drop index if exists uq_publications_draft_published;
create unique index if not exists uq_publications_draft_published
  on publications(draft_id) where status = 'published' and draft_id is not null;
create unique index if not exists uq_publications_video_published
  on publications(video_asset_id) where status = 'published' and video_asset_id is not null;

alter table video_assets enable row level security;
alter table video_transcripts enable row level security;
alter table video_cut_plans enable row level security;
alter table video_renders enable row level security;

create policy video_assets_owner on video_assets
  using (user_id = current_setting('app.current_user_id', true)::uuid);
create policy video_transcripts_owner on video_transcripts
  using (user_id = current_setting('app.current_user_id', true)::uuid);
create policy video_cut_plans_owner on video_cut_plans
  using (user_id = current_setting('app.current_user_id', true)::uuid);
create policy video_renders_owner on video_renders
  using (user_id = current_setting('app.current_user_id', true)::uuid);
