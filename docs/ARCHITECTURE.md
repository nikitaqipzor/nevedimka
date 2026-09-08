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

## Multiple Active Goals (missions)

A user can hold up to `MAX_ACTIVE_MISSIONS` (5, `packages/shared-types`) simultaneously
active missions instead of exactly one. Key structural points:

- `missions.day0_date` / `missions.program_length` are per-mission (migration 011);
  `users.day0_date` / `users.program_length` were dropped — there is no longer an
  account-wide start date or program length.
- The one-active-mission-per-user unique index was replaced by a race-safe trigger
  (`enforce_active_mission_limit`, migration 011) that takes an advisory xact lock on
  the user before counting active missions, so concurrent inserts can't both slip
  past the cap under READ COMMITTED.
- `getActiveMission` (singular) was replaced by `getActiveMissions` (plural, ordered
  oldest-first by `created_at`). Every call site picks explicitly: `/today` plans and
  reports one main task per active mission in a single AI call
  (`planDayForMissions`); jobs/handlers that need a single representative value
  (e.g. a shared `DailyPlan.dayNumber`, or `/api/settings`'s "День 0" display) use the
  oldest active mission (`missions[0]`); the publish caption in `apps/worker` uses the
  most-recently-active mission (`missions[missions.length - 1]`) instead.
- `daily_plans.main_task_id` is no longer written by `createTask` — with N active
  missions there can be N main tasks per plan. "Already planned for today" is
  determined by querying `listTasksForPlan` and filtering `.isMainTask`, not by a
  single foreign key. The column stays on the table (nullable, unused) rather than
  being dropped.
- The Mini App "Путь" screen (`apps/web/src/app/path`) is a goal list with a detail
  view keyed by `missionId` (`/api/path?missionId=...`), not a singleton. Missions can
  transition `active -> paused` ("Отложить") or `active -> completed`/`abandoned` via
  `PATCH /api/missions/[id]`, which reuses the same DB trigger for cap enforcement on
  reactivation (`paused -> active`).
