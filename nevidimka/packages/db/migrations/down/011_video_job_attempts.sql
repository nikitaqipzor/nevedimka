drop index if exists idx_video_assets_claimable;

alter table video_assets drop column if exists next_retry_at;
alter table video_assets drop column if exists attempts;
