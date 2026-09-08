# todo.md

Use this file for active multi-step execution.

## Stabilization Foundation — 2026-09-08
- [x] Add a root-level GitHub Actions workflow for the nested npm monorepo.
- [x] Align core project, architecture, security, command, API, and backlog docs with the real product.
- [x] Remove tracked `tsconfig.tsbuildinfo` files and ignore future incremental metadata.
- [x] Fix clean-checkout `typecheck` ordering for bot tests that import compiled output.
- [x] Verify `npm ci`, `npm run typecheck`, and `npm run build` in a clean temporary copy.
- [x] Run available infrastructure-free tests: 60 passed.
- [x] Record dependency audit baseline: 15 total findings, 9 affecting production dependencies.
- [ ] Verify the root workflow on GitHub after an approved push or pull request.
- [ ] Run the complete Postgres, ffmpeg, and Playwright test suite in CI.
- [ ] Review production dependency upgrades in a dedicated change.
- [x] Design and implement separate Postgres credentials for user and system contexts.
- [x] Make account deletion remove associated evidence, video, and work-directory files.
- [x] Make bot/worker/web storage volumes consistent in Docker Compose.
- [x] Add focused DB-config and filesystem safety tests.
- [ ] Run restricted-role RLS and account-deletion integration tests against Postgres.
- [ ] Smoke-test the Docker role bootstrap and shared volumes with a running daemon.

## Template
- [ ] Understand the task and constraints
- [ ] Read required docs
- [ ] Write short plan
- [ ] Make the smallest safe change
- [ ] Run verification
- [ ] Summarize diff and docs updates
