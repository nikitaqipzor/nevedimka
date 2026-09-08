# AI_CONTEXT.md

## Project
"Невидимка" is an AI mentor delivered through a Telegram bot and a Telegram Mini App/PWA. It supports onboarding, daily planning, focus sessions, evidence and ideas, reflection, analytics, AI mentor chat, content publication, and video preparation.

## Current Priority
Stabilize the implemented Releases 1-4 before expanding product scope: restore CI, align docs, harden database roles and privacy deletion, and verify external integrations in a real environment.

## Stack
- Monorepo: npm workspaces, Node.js 20+, TypeScript
- Bot: grammY and Express webhook/long polling
- Web: Next.js App Router, React, Tailwind CSS, PWA
- Database: Postgres, SQL migrations, RLS, `pg`
- AI: Anthropic API with Zod-validated role responses
- ASR: OpenAI-compatible Whisper transcription endpoint
- Video: ffmpeg/ffprobe background worker
- Logging: Pino
- Testing: Node test runner, Playwright, real Postgres and ffmpeg integration tests
- Runtime packaging: Docker multi-stage images and Docker Compose

## Working Directory
Run application commands from `nevidimka/` until the repository layout is intentionally flattened.

## Commands
- Install: `npm ci`
- Bot development: `npm run dev:bot`
- Web development: `npm run --workspace=apps/web dev`
- Worker development: `npm run --workspace=apps/worker dev`
- Typecheck: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`

## Architecture
- `nevidimka/apps/bot`: Telegram command and conversation flows
- `nevidimka/apps/web`: Mini App/PWA screens and authenticated API routes
- `nevidimka/apps/worker`: video queue polling, processing, and publication
- `nevidimka/packages/db`: migrations, RLS, connection contexts, repositories
- `nevidimka/packages/ai`: provider client, role orchestration, prompts, schemas
- `nevidimka/packages/video`: ASR and ffmpeg pipeline
- `nevidimka/packages/telegram`: shared Telegram Bot API client
- `nevidimka/packages/shared-types`: cross-workspace domain types and validation

## Rules
- Prefer small diffs.
- Read targeted files only.
- Do not change auth, billing, schema, or production config without a plan and approval.
- Run relevant checks after changes.
- Update `docs/DECISIONS.md`, `CHANGELOG.md`, and other affected docs when behavior changes.
- Use `docs/MCP_SERVERS.md`, `docs/TOOLS.md`, and `docs/MEMORY.md` as the operational layer for tools and memory.

## Known Risks
- The root-level and application-level project documentation may drift.
- Separate database credentials and restricted-role RLS still need real Postgres/CI verification.
- Local video storage complicates scaling and backup even though account cleanup now covers its files.
- ASR and Docker deployment have not completed a real production smoke test.
- Worker failures currently rely primarily on logs rather than health metrics and alerts.
