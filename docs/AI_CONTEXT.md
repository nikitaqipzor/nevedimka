# AI_CONTEXT.md

## Project
Default SaaS template for a Next.js application with Supabase for auth and data, Stripe for billing, Vercel for hosting, Playwright for end-to-end checks, and Sentry for monitoring.
Replace this summary with the actual product description after cloning the template.

## Current Priority
Keep the template consistent, safe, and easy to reuse across future SaaS projects.

## Stack
- Framework: Next.js (App Router)
- Language: TypeScript
- Database: Postgres via Supabase
- Hosting: Vercel
- Payments: Stripe
- UI: React + Tailwind CSS
- Testing: Playwright + unit tests via Vitest or Jest
- Monitoring: Sentry

## Commands
- dev: `pnpm dev`
- lint: `pnpm lint`
- typecheck: `pnpm typecheck`
- test: `pnpm test`
- build: `pnpm build`

## Architecture
- `app/` or `src/app/`: routes, layouts, server components, route handlers
- `components/`: reusable UI and feature components
- `lib/`: shared clients, formatters, adapters, utilities
- `server/`: business logic, actions, service layer, webhook handlers
- `supabase/` or `db/`: migrations, policies, seeds, generated types

## Rules
- Prefer small diffs.
- Read targeted files only.
- Do not change auth, billing, schema, or production config without a plan and approval.
- Run relevant checks after changes.
- Update `docs/DECISIONS.md`, `CHANGELOG.md`, and other affected docs when behavior changes.
- Use `docs/MCP_SERVERS.md`, `docs/TOOLS.md`, and `docs/MEMORY.md` as the operational layer for tools and memory.

## Known Risks
- RLS or auth regressions can expose protected data.
- Stripe webhook mistakes can create billing drift.
- Vercel env or config mistakes can break production at deploy time.
- Missing Sentry coverage can hide runtime failures after release.
