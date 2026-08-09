# ARCHITECTURE.md

## Overview
This template assumes a Next.js App Router web app with a React UI, server-side business logic, Supabase-backed persistence, Stripe billing, Vercel deployment, and Sentry monitoring.
Most authenticated user flows should follow this pattern:
- request enters via route, page, action, or webhook
- server or service layer validates auth and business rules
- data access happens through Supabase or database helpers
- external billing logic goes through Stripe adapters or handlers
- observability flows through logs and Sentry where relevant

## Main Areas
- `app/` or `src/app/`: routes, layouts, pages
- `components/`: reusable UI and presentation logic
- `lib/`: shared clients, helpers, adapters
- `server/`: business logic, actions, services, jobs
- `db/` or `supabase/`: schema, migrations, policies, seeds
- `docs/`: project memory and operating rules

## Data Flow
Document the normal path for a user action.

Example:
UI -> route or server action -> domain or service layer -> database or external API -> response -> UI

Billing example:
User action -> server action or route handler -> Stripe adapter -> webhook confirmation -> database update -> UI refresh

Auth example:
User login or session check -> auth layer -> Supabase session/user context -> protected query or mutation -> UI

## Critical Boundaries
- Keep UI concerns in components.
- Keep business rules in a server or domain layer.
- Keep external services behind dedicated adapters or clients.
- Keep database access consistent and policy-aware.
- Isolate auth, billing, and analytics integrations from page-level code.

## High-Risk Areas
- Authentication and authorization
- Billing, subscriptions, and webhooks
- Database schema and RLS
- Background jobs and retries
- Production config and secrets handling

## Notes
- Prefer server-side enforcement for permissions and billing-sensitive operations.
- Keep Stripe webhook handling isolated from page-level UI code.
- Keep Supabase policies and schema decisions documented when they change.
