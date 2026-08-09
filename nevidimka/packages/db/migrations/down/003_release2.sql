-- Reverses 003_release2.sql.

drop policy if exists mentor_messages_owner on mentor_messages;
drop table if exists mentor_messages;

drop index if exists idx_evidences_user_created;
drop index if exists idx_tasks_user_direction;
alter table tasks drop column if exists direction;
