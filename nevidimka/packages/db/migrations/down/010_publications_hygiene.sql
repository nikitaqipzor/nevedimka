-- Reverses 010_publications_hygiene.sql: restores the original NO ACTION
-- delete behavior on the three publications FKs and drops the two indexes.

drop index if exists idx_publications_video_asset;
drop index if exists idx_video_cut_plans_asset;

alter table publications drop constraint publications_video_render_id_fkey;
alter table publications add constraint publications_video_render_id_fkey
  foreign key (video_render_id) references video_renders(id);

alter table publications drop constraint publications_video_asset_id_fkey;
alter table publications add constraint publications_video_asset_id_fkey
  foreign key (video_asset_id) references video_assets(id);

alter table publications drop constraint publications_content_version_id_fkey;
alter table publications add constraint publications_content_version_id_fkey
  foreign key (content_version_id) references content_versions(id);
