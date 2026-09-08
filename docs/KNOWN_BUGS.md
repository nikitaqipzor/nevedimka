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
- Status: Root workflow added; verify on the next GitHub push or pull request.

### External deployment paths are not fully smoke-tested
- Symptoms: Docker, ASR, Telegram webhook, or storage behavior may fail only in a real environment.
- Scope: first production deployment.
- Workaround: deploy to staging and execute the launch checklist before production.
- Status: Open.

### Dependency audit reports high-severity findings
- Symptoms: `npm audit` reports 10 high and 5 moderate findings in the current lockfile, including direct dependencies in the Next.js/PostCSS/Tailwind and Express stacks.
- Scope: web build/runtime, bot HTTP server, and scheduling dependencies.
- Workaround: do not expose the application publicly before reviewing advisories and testing compatible upgrades.
- Status: Open; requires a dedicated dependency-upgrade change because several findings have no automatic fix.

## Watchlist
- Session lifetime and revocation
- Worker queue recovery and dead-letter visibility
- AI cost spikes and provider rate limits
- Documentation drift between repository root and application README

## Resolved Pending Infrastructure Verification

### Database privilege model used one connection pool
- Resolution: split request and system pools across `DATABASE_URL` and `SYSTEM_DATABASE_URL`; production rejects missing or identical credentials, and Compose provisions a `NOBYPASSRLS` application role.
- Verification: focused configuration tests pass; restricted-role Postgres integration remains to run in CI/staging.

### Account deletion left local files
- Resolution: deletion now removes validated evidence/video paths and full per-asset work directories before the database cascade; bot, web, and worker share the required Compose volumes.
- Verification: filesystem unit tests pass, including traversal and symlink guards; the Postgres-backed full-flow test is updated but awaits infrastructure.
