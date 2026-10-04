# COMMANDS.md

Run these commands from `nevidimka/`.

## Core Commands
- Install locked dependencies: `npm ci`
- Start bot: `npm run dev:bot`
- Start web: `npm run --workspace=apps/web dev`
- Start worker: `npm run --workspace=apps/worker dev`
- Run typecheck: `npm run typecheck`
- Run tests: `npm test`
- Run build: `npm run build`
- Apply migrations: `npm run db:migrate`
- Roll back one migration: `npm run db:migrate:down`

## Focused Verification
- AI tests: `npm run test --workspace=packages/ai`
- Database tests: `npm run test --workspace=packages/db`
- Video tests: `npm run test --workspace=packages/video`
- Bot tests: `npm run test --workspace=apps/bot`
- Web tests: `npm run test --workspace=apps/web`
- One Node test: `node --import tsx --test <path-to-test-file>`
- Validate Compose without a local `.env`: `POSTGRES_PASSWORD=check_system APP_DB_PASSWORD=check_app ENV_FILE=.env.example docker compose config --quiet`

## Verification Order
1. Run the smallest relevant command first.
2. Run broader checks if the change touches shared or risky areas.
3. For auth, billing, schema, or deployment changes, prefer targeted verification plus at least one broader check.

## Notes
- Database tests require a superuser `DATABASE_URL` because they create temporary databases and roles.
- Video tests require `ffmpeg` and `ffprobe` in `PATH`.
- Web end-to-end tests require Playwright Chromium.
- There is not yet a lint command; adding one is part of the stabilization backlog.
- Never report completion without running the relevant commands or stating the verification gap.

## Launch Checks
- Runtime configuration tests (after shared-types build): `npm run test:runtime`
- Security audit: `npm audit --audit-level=moderate`
- Disposable production Docker/DB/storage/deletion smoke: `npm run smoke:compose`
- Live credentials and provider requests after build: `npm run smoke:integrations`
- Optional billable real ASR: `npm run smoke:integrations -- --asr /path/to/test.ogg`
- Use Node.js 22+; the live smoke reads local `.env`, never changes webhook settings, and does not publish to Telegram.
