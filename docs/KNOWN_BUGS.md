# KNOWN_BUGS.md

Track recurring issues and fragile areas.

## Template
### Title
- Symptoms:
- Scope:
- Workaround:
- Suspected cause:
- Status:

## Active Issues

### CI workflow was nested below the repository root
- Symptoms: GitHub does not discover `nevidimka/.github/workflows/ci.yml`.
- Scope: all automated typecheck, build, database, video, bot, and web checks.
- Workaround: root `.github/workflows/ci.yml` runs commands from `nevidimka/`.
- Status: Root workflow is discovered and runs typecheck/build/audit, Postgres tests and Docker smoke on PR #1.

### External deployment paths are not fully smoke-tested
- Symptoms: Docker, ASR, Telegram webhook, or storage behavior may fail only in a real environment.
- Scope: first production deployment.
- Workaround: deploy to staging and execute the launch checklist before production.
- Status: Open.

### Launch infrastructure verification
- Symptoms: historical web E2E assertions passed, then CI hung with orphaned next-server processes and active Postgres sessions.
- Resolution: POSIX process-group teardown with a regression test, bounded resource cleanup and guaranteed admin disconnect; Windows retains taskkill tree cleanup.
- Status: resolved; all 46 web tests and teardown pass in GitHub run 37244899244.

### Dependency audit findings
- Resolution: Next/Express/node-cron upgrades, Tailwind 4 dedicated PostCSS adapter and patched transitive overrides. Fresh lockfile audit: 0 findings.
- Verification: clean install, typecheck and production build pass locally; all browser tests, signed initData authentication and Tailwind layout checks pass in CI.

### New account started at Day 2 near UTC midnight
- Cause: users.day0_date used server current_date, while bot/web count days in the user's Europe/Amsterdam timezone.
- Resolution: user creation explicitly stores the initial date in the same timezone; existing account dates remain unchanged on upsert. A full-flow assertion checks day0_date against created_at in the user timezone.
- Verification: bot full-flow passes in CI; web plan fixtures now also use the user timezone.

## Watchlist
- Session lifetime and revocation
- Worker queue recovery and dead-letter visibility
- AI cost spikes and provider rate limits
- Documentation drift between repository root and application README

## Resolved and Verified in CI

### Database privilege model used one connection pool
- Resolution: split request and system pools across `DATABASE_URL` and `SYSTEM_DATABASE_URL`; production rejects missing or identical credentials, and Compose provisions a `NOBYPASSRLS` application role.
- Verification: focused configuration tests pass; restricted-role Postgres integration passes in CI, including real startup privilege checks.

### Account deletion left local files
- Resolution: deletion now removes validated evidence/video paths and full per-asset work directories before the database cascade; bot, web, and worker share the required Compose volumes.
- Verification: filesystem unit tests pass, including traversal and symlink guards; Postgres-backed deletion and production web deletion/storage isolation pass in disposable Docker smoke.
