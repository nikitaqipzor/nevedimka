# API_CONTRACTS.md

Interfaces that changes must preserve unless a migration plan says otherwise.

## Internal Contracts
- Web API routes require a verified `nevidimka_session` cookie except `/api/auth/miniapp`.
- State-changing web API requests pass the central Fetch Metadata CSRF gate.
- User-owned repository calls receive `userId` and run under `withUserContext`.
- AI roles return Zod-validated structured responses and log usage/cost metadata.
- Video jobs move through persisted statuses and may be retried without duplicate publication.
- Text and video publication require an immutable confirmed snapshot and an idempotency constraint.

## External Contracts
- Telegram Mini App authentication: server-side validation of signed `initData`.
- Telegram Bot API: commands, webhook secret, message/channel publication, media download.
- Anthropic API: role execution with timeout, retry, rate limit, and structured parsing.
- OpenAI-compatible ASR: multipart transcription returning verbose JSON segments.
- Postgres: ordered migrations through `SYSTEM_DATABASE_URL`; transaction-scoped user context through the restricted `DATABASE_URL`; production credentials must differ.
- Local storage: server-generated paths must remain under `EVIDENCE_STORAGE_ROOT` or `VIDEO_STORAGE_ROOT`; account deletion fails closed on escaped paths.
- Account deletion: returns a conflict while any owned video asset is `processing` or `rendering`; callers must ask the user to retry after processing stops.
- ffmpeg/ffprobe: bounded child processes and verified output files.

## Contract Template
### Name
- Owner:
- Input:
- Output:
- Error cases:
- Idempotency requirements:
- Auth or RLS implications:
- Notes:
