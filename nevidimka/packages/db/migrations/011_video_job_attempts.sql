-- Bounds the video pipeline's automatic retry, which was previously
-- unbounded.
--
-- Confirmed failure mode: recoverStaleVideoJobs
-- (packages/db/src/repository.ts) requeues anything sitting in
-- 'processing'/'rendering' past WORKER_STALE_JOB_MINUTES by resetting it to
-- 'uploaded'/'confirmed'. That is the right recovery for a worker that
-- crashed mid-job, but it had no attempt counter, so a job that kills the
-- worker *process* rather than throwing — OOM on a large render, a
-- container restart, an ffmpeg invocation that wedges past its SIGKILL, a
-- host reboot — comes back as 'uploaded', gets picked up again, kills the
-- worker again, and loops forever. Every cycle also re-pays for ASR
-- transcription (packages/video/src/asr.ts), so an un-processable upload
-- burns real money indefinitely with nothing surfacing it.
--
-- PROJECT_SPEC.md section 14 requires "retry с экспоненциальной задержкой и
-- ограничением попыток" plus "dead-letter обработка для задач, исчерпавших
-- retry". This adds the two columns that make both expressible:
--
--   attempts      — incremented each time the job is actually claimed for
--                   processing, never reset, so it survives requeues.
--   next_retry_at — earliest time the job may be claimed again. Set by
--                   recoverStaleVideoJobs to now() + an exponential backoff
--                   based on attempts, so a job that keeps dying backs off
--                   instead of hot-looping. NULL means "claimable now",
--                   which is the correct default for a fresh upload.
--
-- Dead-letter is expressed in the existing status vocabulary rather than a
-- separate table: a job that exhausts its attempts goes to 'failed' with an
-- error_message saying so. 'failed' is already terminal — nothing requeues
-- out of it — and is already surfaced to the user in the bot and Mini App,
-- so exhausted jobs become visible instead of silently looping. Adding a
-- distinct 'dead_letter' status would require touching the status CHECK
-- constraint, every VideoAssetStatus consumer, and both UIs for no
-- behavioural gain over that.

alter table video_assets
  add column if not exists attempts int not null default 0;

alter table video_assets
  add column if not exists next_retry_at timestamptz;

-- Supports the worker's claim query, which now filters on
-- (status, next_retry_at) and orders by created_at.
create index if not exists idx_video_assets_claimable
  on video_assets(status, next_retry_at, created_at);
