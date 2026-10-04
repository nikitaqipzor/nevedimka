# TASKS.md

High-level project priorities live here.

## Current Priorities
- Keep the verified root CI gates green: audit/build, full Postgres/RLS/Playwright suite and disposable Docker production smoke.
- Provision deployment credentials, public HTTPS and backups; use `LAUNCH_CHECKLIST.md`.
- Run live Telegram/Anthropic smoke and optional real ASR with deployment credentials.
- Verify owner-only product flow and publication in a test channel before production.

Production configuration/DB privilege checks, webhook authentication, E2E teardown regression coverage and Compose storage/deletion smoke are implemented. The refreshed lockfile reports zero findings locally; CI gates `npm audit --audit-level=moderate`. Infrastructure verification passes in GitHub run 37244899244; live/deployment results must be recorded in `tasks/todo.md` before marking launch complete.

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
