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
- [x] Verify the root workflow on GitHub after an approved push or pull request.
- [x] Run the complete Postgres, ffmpeg, and Playwright test suite in CI.
- [x] Review production dependency upgrades in the launch-readiness branch.
- [x] Design and implement separate Postgres credentials for user and system contexts.
- [x] Make account deletion remove associated evidence, video, and work-directory files.
- [x] Make bot/worker/web storage volumes consistent in Docker Compose.
- [x] Add focused DB-config and filesystem safety tests.
- [x] Run restricted-role RLS and account-deletion integration tests against Postgres.
- [x] Smoke-test the Docker role bootstrap and shared volumes with a running daemon.

## Template
- [ ] Understand the task and constraints
- [ ] Read required docs
- [ ] Write short plan
- [ ] Make the smallest safe change
- [ ] Run verification
- [ ] Summarize diff and docs updates

## Launch Readiness — 2026-10-04
- [x] Confirm baseline HEAD and existing CI evidence.
- [x] Fix POSIX E2E process-tree cleanup and add regression coverage.
- [x] Require production configuration and verify actual DB privileges at runtime.
- [x] Enforce owner-only access in Mini App authentication and existing sessions.
- [x] Test webhook secret rejection and authenticated delivery.
- [x] Repair Docker manifests and bind exposed ports to loopback.
- [x] Upgrade vulnerable dependencies and migrate Tailwind to the supported PostCSS adapter.
- [x] Verify clean install, typecheck and production build; audit reports 0 findings.
- [x] Local focused verification: 5 runtime tests, 64 infrastructure-free tests, 12 real ffmpeg pipeline tests.
- [x] Confirm web teardown no longer hangs: suite exits in 55s and drops its database.
- [x] Use local-day E2E fixtures and signed Telegram SDK fixture with dev auth disabled.
- [x] Verify final full Postgres/Playwright suite in root CI: run 37244899244, all three jobs passed (140 tests).
- [x] Verify disposable Compose bootstrap, volume sharing and production account deletion: GitHub job 111558211520.
- [x] Fix new-user local Day 0 date after full CI exposed a UTC/user-timezone mismatch.
- [ ] Real Telegram/Anthropic/optional ASR smoke with deployment credentials (not available in this environment).

Launch verification: https://github.com/nikitaqipzor/nevedimka/actions/runs/37244899244 (tested code b644ff2). Real provider/deployment smoke remains pending credentials.
