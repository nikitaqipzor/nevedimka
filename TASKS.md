# TASKS.md

High-level project priorities live here.

## Current Priorities
- Verify the new root-level CI workflow on GitHub.
- Verify separate request/system Postgres roles against a real database.
- Verify end-to-end account deletion and shared storage volumes in Docker.
- Validate runtime environment variables centrally and fail fast on invalid production configuration.
- Review and upgrade dependencies responsible for 10 high and 5 moderate `npm audit` findings.
- Smoke-test Docker Compose, Telegram webhook mode, and real ASR.

## Next Up
- Add lint/format checks and a sustainable dependency/security scanning policy.
- Move video storage to a private object store with signed URLs.
- Split `packages/db/src/repository.ts` by domain while preserving exports.
- Add direct worker, Telegram package, logger, and shared-types tests.
- Prepare a separate security design for multi-user mode.

## Deferred
- Open multi-user registration
- Native mobile applications
- Complex semantic video editing
- Large refactors not tied to a production or product outcome

## Usage Rules
- Keep this file strategic, not session-by-session.
- Use `tasks/todo.md` for execution details and checklists.
- Update this file when product priorities change.
