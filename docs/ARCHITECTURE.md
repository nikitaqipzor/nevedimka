# ARCHITECTURE.md

## Overview
The product is an npm workspaces monorepo with three runtime applications: a Telegram bot, a Next.js Mini App/PWA, and a background video worker. Shared packages own database access, AI orchestration, Telegram integration, video processing, logging, and domain types.

## Main Areas
- `nevidimka/apps/bot`: Telegram transport and user conversation state
- `nevidimka/apps/web`: UI, session authentication, CSRF gate, API routes
- `nevidimka/apps/worker`: video queue claims, ffmpeg pipeline, publication
- `nevidimka/packages/db`: persistence and RLS enforcement
- `nevidimka/packages/ai`: provider retries, role prompts, response schemas, cost logging
- `nevidimka/packages/video`: probing, transcription, cuts, transforms, previews
- `nevidimka/packages/telegram`: Telegram Bot API operations
- `nevidimka/packages/shared-types`: shared domain contracts

## Data Flows
- Bot: Telegram update -> grammY middleware -> handler -> shared package -> Postgres/AI/Telegram -> reply
- Web: Telegram `initData` -> signed session cookie -> API route -> shared package -> Postgres/AI -> JSON -> React UI
- Video: Telegram upload -> shared `VIDEO_STORAGE_ROOT` + DB asset -> worker claim -> ASR/ffmpeg -> preview -> user confirmation -> final render -> Telegram publication
- Reminder: hourly cron -> system-scoped user query -> timezone check -> Telegram message

## Critical Boundaries
- Every user-owned database operation must run through `withUserContext`.
- `DATABASE_URL` must use a `NOBYPASSRLS` role; migrations and reviewed system operations use the distinct `SYSTEM_DATABASE_URL` pool.
- Account deletion may remove only paths contained by `EVIDENCE_STORAGE_ROOT` or `VIDEO_STORAGE_ROOT`, including real-path checks against symlink escape.
- Bot and web must share domain behavior rather than independently reimplementing rules.
- Publication must remain idempotent and require explicit confirmation.
- External providers must stay behind package-level adapters with timeouts and bounded retries.
- Video paths must never be accepted directly from client input.

## High-Risk Areas
- Telegram authentication, sessions, and owner gate
- Database roles, schema, migrations, and RLS
- Publication, editing, and deletion of channel messages
- AI privacy and spending controls
- Local file storage and account deletion
- Worker recovery, duplicate jobs, and retries
- Production config, secrets, and deployment

## Notes
- The application remains nested under `nevidimka/` for now. Root CI uses that directory explicitly.
- `packages/db/src/repository.ts` is a known oversized module and should be split by domain without changing its public contracts.
- Local disk storage is acceptable for owner-only development; all deleting processes must mount both roots, but private object storage remains the multi-user target.
