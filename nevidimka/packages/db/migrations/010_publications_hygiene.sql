-- Fixes two low-priority schema gaps found during a schema review:
--
-- 1. FK cascade behavior: content_version_id / video_asset_id / video_render_id
--    on publications were all defined with the implicit NO ACTION delete
--    behavior (confirmed live: publications_content_version_id_fkey,
--    publications_video_asset_id_fkey, publications_video_render_id_fkey —
--    see 004_release3.sql "content_version_id uuid not null references
--    content_versions(id)" and 005_release4.sql "add column if not exists
--    video_asset_id uuid references video_assets(id)" / "video_render_id uuid
--    references video_renders(id)", none of which specify ON DELETE). Every
--    other FK on publications (user_id, draft_id) already cascades. Today
--    nothing exercises this gap: the only DELETE in the codebase is
--    deleteUserAccount (packages/db/src/repository.ts), which removes the
--    parent users row and cascades through publications_user_id_fkey, never
--    deleting a single content_version/video_asset/video_render row on its
--    own. This migration closes the gap defensively so a future
--    single-row-delete feature doesn't hit an FK violation instead of
--    cascading correctly.
--
--    Postgres has no ALTER ... ON DELETE syntax, so each constraint must be
--    dropped and recreated.
--
-- 2. Missing indexes for existing lookup queries:
--    - getLatestVideoCutPlan (packages/db/src/repository.ts) runs
--        select * from video_cut_plans where video_asset_id = $1 and user_id = $2
--        order by created_at desc limit 1
--      and video_cut_plans (005_release4.sql) has no index beyond its
--      primary key.
--    - getPublicationByVideoAssetId (packages/db/src/repository.ts) runs
--        select * from publications where video_asset_id = $1 and user_id = $2
--        order by created_at desc limit 1
--      the same shape. publications already has idx_publications_draft
--      (draft_id) and idx_publications_user (user_id, created_at desc) for
--      the equivalent draft/user lookups, but nothing for video_asset_id.
--      uq_publications_video_published is a *partial* unique index (WHERE
--      status IN ('pending','published')), so it cannot serve a general
--      video_asset_id lookup across all statuses.
--    Both new indexes are (video_asset_id, created_at desc) -- matching the
--    real query's ORDER BY ... LIMIT 1 -- for consistency with the existing
--    idx_publications_user / idx_video_renders_asset / idx_video_assets_user
--    pattern already used in this schema.

alter table publications drop constraint publications_content_version_id_fkey;
alter table publications add constraint publications_content_version_id_fkey
  foreign key (content_version_id) references content_versions(id) on delete cascade;

alter table publications drop constraint publications_video_asset_id_fkey;
alter table publications add constraint publications_video_asset_id_fkey
  foreign key (video_asset_id) references video_assets(id) on delete cascade;

alter table publications drop constraint publications_video_render_id_fkey;
alter table publications add constraint publications_video_render_id_fkey
  foreign key (video_render_id) references video_renders(id) on delete cascade;

create index if not exists idx_video_cut_plans_asset
  on video_cut_plans(video_asset_id, created_at desc);
create index if not exists idx_publications_video_asset
  on publications(video_asset_id, created_at desc);
