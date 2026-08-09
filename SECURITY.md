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
- Billing and payment flows
- Database schema and migrations
- RLS policies and data access rules
- Production configuration
- Webhooks and background jobs that affect money or access

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
- Billing and Stripe flows
- Supabase RLS and access control
- Database migrations
- Production deploys
- Data deletion
- Environment and secrets changes

## Verification Expectations
- Sensitive changes need focused verification and at least one broader confidence check when possible.
- If verification is incomplete, state the gap explicitly.
