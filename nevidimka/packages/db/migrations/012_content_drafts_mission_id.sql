-- Adds optional mission attribution to content_drafts, so a draft can be
-- tied to a specific mission at creation time instead of only at publish
-- time (see docs/superpowers/specs — multi-active-goals follow-up, Item 3).
-- Nullable FK mirrors the existing tasks.mission_id idiom in 001_init.sql
-- (optional attribution, on delete set null — a draft outlives its mission).
--
-- No backfill: existing content_drafts rows have no reliable source to
-- infer their mission from (unlike 011's users -> missions backfill, which
-- had one account-wide value to copy), so they keep mission_id = null.
alter table content_drafts add column if not exists mission_id uuid references missions(id) on delete set null;
create index if not exists idx_content_drafts_mission on content_drafts(mission_id);
