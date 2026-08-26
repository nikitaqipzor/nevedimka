-- Reverses 012_content_drafts_mission_id.sql.
drop index if exists idx_content_drafts_mission;
alter table content_drafts drop column if exists mission_id;
