-- Adds edit tracking to publications, needed for FEATURE_ROADMAP.md item 3
-- (edit/delete an already-published post). published_html stays exactly
-- what it always was — the immutable record of what was originally sent
-- (same "exact snapshot" guarantee documented for content_versions in
-- migration 004) — edits are tracked separately so you can always see
-- both what was originally published and what it currently says.

alter table publications add column if not exists edited_html text;
alter table publications add column if not exists edited_at timestamptz;
