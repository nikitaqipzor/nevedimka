-- Reverses 009_publications_pending_unique.sql: restores the narrower guard
-- that only forbids two 'published' rows (not 'pending' ones) for the same
-- draft_id / video_asset_id, as established by 005_release4.sql.

drop index if exists uq_publications_draft_published;
create unique index if not exists uq_publications_draft_published
  on publications(draft_id) where status = 'published' and draft_id is not null;

drop index if exists uq_publications_video_published;
create unique index if not exists uq_publications_video_published
  on publications(video_asset_id) where status = 'published' and video_asset_id is not null;
