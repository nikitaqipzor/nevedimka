-- Reverses 005_release4.sql.
--
-- NOTE: the two `set not null` statements at the end will fail if any
-- video-only publication rows exist (content_version_id/draft_id NULL for
-- those) — that's correct, expected behavior: you cannot cleanly revert to
-- a schema that can't represent data created under the newer one. Delete
-- or migrate those rows first if you really need to roll back past a
-- point where video publications exist.

drop policy if exists video_assets_owner on video_assets;
drop policy if exists video_transcripts_owner on video_transcripts;
drop policy if exists video_cut_plans_owner on video_cut_plans;
drop policy if exists video_renders_owner on video_renders;

drop index if exists uq_publications_video_published;
drop index if exists uq_publications_draft_published;

alter table publications drop constraint if exists chk_publications_content_or_video;
alter table publications drop column if exists video_render_id;
alter table publications drop column if exists video_asset_id;
alter table publications alter column content_version_id set not null;
alter table publications alter column draft_id set not null;

create unique index if not exists uq_publications_draft_published
  on publications(draft_id) where status = 'published';

drop table if exists video_renders;
drop table if exists video_cut_plans;
drop table if exists video_transcripts;
drop table if exists video_assets;
