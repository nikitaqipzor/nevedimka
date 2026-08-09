-- Reverses 004_release3.sql. publications must go first (it references
-- both content_drafts and content_versions).

drop table if exists publications;
alter table if exists content_drafts drop constraint if exists fk_content_drafts_chosen_version;
drop table if exists content_versions;
drop table if exists content_drafts;
