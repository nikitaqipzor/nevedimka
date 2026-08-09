-- Closes a race in the publish flow: both the bot's /post command
-- (apps/bot/src/handlers/content.ts handlePostPublish) and the Mini App's
-- "Студия" publish action (apps/web/src/app/api/content/[id]/route.ts) were
-- patched to check the draft's status before publishing, but that is a
-- check-then-act race, not a guarantee. The partial unique indexes created
-- in 004_release3.sql / widened in 005_release4.sql only forbid a second
-- row with status = 'published' for the same draft_id / video_asset_id —
-- they do NOT forbid two concurrent 'pending' rows. Confirmed failure mode:
-- two near-simultaneous publish attempts can both insert a 'pending'
-- publications row (allowed today), both actually send the message/video to
-- the Telegram channel, and only the second markPublicationSent call fails
-- afterwards — i.e. after the duplicate send already happened.
--
-- Widening the guard to also cover 'pending' makes the SECOND insert itself
-- fail at the database level, before any Telegram send happens, as long as
-- an existing row for the same draft_id/video_asset_id is still 'pending'
-- or 'published'.
--
-- Deliberately excludes 'failed': markPublicationFailed
-- (packages/db/src/repository.ts) transitions the existing row from
-- 'pending' to 'failed' in place via UPDATE — it does not insert a new row —
-- and both handlePostPublish (apps/bot/src/handlers/content.ts) and the web
-- route (apps/web/src/app/api/content/[id]/route.ts) call
-- updateDraftStatus(..., "failed") and tell the user to retry via /post
-- after a genuine send failure. Once a row's status is 'failed' it no
-- longer matches this predicate, so a retry can insert a fresh 'pending'
-- row for the same draft/video, exactly as the application code expects.
-- Including 'failed' here would permanently block retries after any
-- real publish failure, which is not the intended behavior.

drop index if exists uq_publications_draft_published;
create unique index if not exists uq_publications_draft_published
  on publications(draft_id) where status in ('pending', 'published') and draft_id is not null;

drop index if exists uq_publications_video_published;
create unique index if not exists uq_publications_video_published
  on publications(video_asset_id) where status in ('pending', 'published') and video_asset_id is not null;
