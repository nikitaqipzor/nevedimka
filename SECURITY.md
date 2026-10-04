# SECURITY.md

Security rules for all agents and contributors.

## Secrets
- Never print secrets, tokens, API keys, or credentials.
- Never commit secrets.
- Never change `.env` or secret-management files without explicit approval.

## Sensitive Systems
The following areas require a plan and explicit confirmation before changes:
- Authentication
- Authorization
- Database schema and migrations
- RLS policies and data access rules
- Telegram channel publication and webhook handling
- AI provider configuration and privacy controls
- Video and evidence storage
- Production configuration and background jobs

## Database Safety
- Use migrations for schema changes.
- Explain the impact on existing data before making a migration.
- Do not drop or rename tables or columns without approval.
- Review RLS and permission implications on every data-layer change.

## Operational Safety
- Do not disable security checks to "make it work."
- Do not weaken validation, access control, or auditability for speed.
- Treat logs, screenshots, and diffs as potentially sensitive.
- Do not allow autonomous workflows to bypass approval gates for risky areas.

## Autonomous Workflow Limits
The following areas must stay human-approved even if automation tooling is available:
- Authentication
- Postgres RLS and access control
- Database migrations
- Production deploys
- Data deletion
- Telegram publication behavior
- Environment and secrets changes

## Current Security Status
- Request-scoped operations use `DATABASE_URL`; reviewed cross-user operations and migrations use a separate `SYSTEM_DATABASE_URL`. Production rejects missing URLs, identical usernames, privileged request roles and request ownership of non-forced RLS tables. The system role must bypass RLS.
- Account deletion validates and removes referenced evidence/video files and per-asset work directories before deleting database rows; it fails closed while a video worker is active.
- Restricted-role RLS, runtime DB privilege checks, shared volumes and production account deletion pass in CI/Docker. Live provider calls and deployment-level HTTPS/webhook delivery require deployment credentials.
- Production requires a numeric owner ID; bot updates, Mini App registration and existing session verification enforce it. Webhook mode requires a secret and validates incoming secret headers. Test API overrides and dev authentication are rejected at startup.
- Multi-user registration remains disabled until that verification, storage isolation, quotas, and the broader security review are complete.

## Verification Expectations
- Sensitive changes need focused verification and at least one broader confidence check when possible.
- If verification is incomplete, state the gap explicitly.
