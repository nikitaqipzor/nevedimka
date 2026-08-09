# PROJECT.md

Project-level briefing for all agents.

## What This Project Is
Opinionated template for a modern SaaS web app built with Next.js, Supabase, Vercel, Stripe, Playwright, and Sentry.
Use this repo as the starting point for new projects, then replace the product-specific details with the actual domain, users, and business model.
Default assumptions:
- web-first product
- authenticated user accounts
- subscription or billing support
- protected server-side data access
- production monitoring and error tracking

## Who It Serves
Teams shipping subscription-based or account-based products that need a repeatable, safe AI-friendly project skeleton.

## Current Phase
- Template / foundation

## Current Priority
Turn this reusable template into a safe default starting point for future SaaS projects.

## Non-Goals
- Building product-specific business logic in the template itself
- Choosing a niche domain up front
- Hard-coding a single database schema
- Pre-optimizing for enterprise-scale complexity before a project needs it

## Risk Areas
- Authentication
- Authorization
- Billing
- Database schema
- Production configuration

## Required Reading
Agents must read in this order:
1. `PROJECT.md`
2. `SECURITY.md`
3. `docs/AI_CONTEXT.md`
4. `docs/COMMANDS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`
7. `docs/API_CONTRACTS.md` when relevant
8. `docs/KNOWN_BUGS.md` when relevant
9. `TASKS.md`
10. `tasks/lessons.md`

## Memory Hierarchy
- Session memory is advisory.
- `docs/DECISIONS.md` is the source of truth for decisions.
- `docs/ARCHITECTURE.md` is the source of truth for architecture.
- `SECURITY.md` is the source of truth for security rules.
