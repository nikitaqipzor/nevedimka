-- Per-user channel connection (FEATURE_ROADMAP.md item 5). Nullable —
-- falls back to the global TELEGRAM_CHANNEL_ID env var at call sites when
-- unset, so existing single-channel .env setups keep working unchanged.

alter table users add column if not exists channel_id text;
