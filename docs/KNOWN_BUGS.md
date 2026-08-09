# KNOWN_BUGS.md

Track recurring issues and fragile areas.

## Template
### Title
- Symptoms:
- Scope:
- Workaround:
- Suspected cause:
- Status:

## Watchlist
Use this section for risk hotspots even when there is no active bug.

### Auth and Billing
- Symptoms: Regressions here can lock users out or affect money movement.
- Scope: Login, signup, sessions, roles, subscriptions, invoices, webhooks.
- Workaround: Require plan, focused verification, and explicit approval for sensitive changes.
- Suspected cause: High coupling to external services and policy rules.
- Status: High risk surface.

### Schema and RLS
- Symptoms: Data disappears, data leaks, or queries fail for some roles.
- Scope: migrations, policies, generated types, protected queries.
- Workaround: review schema diffs and RLS implications before applying.
- Suspected cause: policy drift, unreviewed migrations, missing role coverage.
- Status: High risk surface.

### Deploy and Monitoring
- Symptoms: app works locally but fails after release, silent production errors, broken env assumptions.
- Scope: Vercel envs, build config, runtime config, Sentry setup.
- Workaround: use at least one broader verification step for deploy-sensitive changes.
- Suspected cause: environment mismatch or missing observability coverage.
- Status: High risk surface.
