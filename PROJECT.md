# PROJECT.md

Project-level briefing for all agents.

## What This Project Is
"Невидимка" is an AI mentor for a structured personal-growth cycle. The product combines a Telegram bot, a Telegram Mini App/PWA, AI-assisted planning and reflection, content publication, and a background video-processing pipeline.

The canonical application currently lives in `nevidimka/` as an npm workspaces monorepo. The repository root contains project governance and operational documentation.

## Who It Serves
The current release is optimized for an owner-operated installation. Multi-user operation is a planned capability and must not be enabled until database-role separation, storage isolation, quotas, and security verification are complete.

## Current Phase
- Releases 1-4 implemented
- Post-release stabilization and production hardening

## Current Priority
1. Restore a reliable root-level CI quality gate.
2. Align project documentation with the actual application.
3. Verify the implemented database-role and data-deletion hardening against real infrastructure.
4. Verify Docker, ASR, and deployment behavior against real infrastructure.

## Non-Goals
- Native mobile applications; the Telegram Mini App/PWA is the supported client.
- Automatic publication without explicit user confirmation.
- Complex cinematic video editing or generated achievements.
- Open multi-user registration before the security hardening milestone.

## Risk Areas
- Telegram authentication and owner access control
- Postgres RLS and privileged system operations
- Publication to Telegram channels
- AI privacy, cost controls, and prompt safety
- Video storage and deletion
- Background jobs, retries, and idempotency
- Production configuration and secrets

## Required Reading
Agents must read in this order:
1. `PROJECT.md`
2. `SECURITY.md`
3. `docs/AI_CONTEXT.md`
4. `docs/COMMANDS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`
7. `docs/API_CONTRACTS.md` when relevant
8. `docs/KNOWN_BUGS.md` when relevant
9. `TASKS.md`
10. `tasks/lessons.md`

## Memory Hierarchy
- Session memory is advisory.
- `docs/DECISIONS.md` is the source of truth for decisions.
- `docs/ARCHITECTURE.md` is the source of truth for architecture.
- `SECURITY.md` is the source of truth for security rules.
