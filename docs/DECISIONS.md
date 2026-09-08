# DECISIONS.md

Record short architectural, workflow, and security decisions here.

## Template
### YYYY-MM-DD
- Decision:
- Why:
- Impact:

## Entries
### 2026-07-03
- Decision: Keep shared project context in top-level project docs and `docs/*`, while keeping `AGENTS.md` and `CLAUDE.md` agent-specific.
- Why: Reduces duplication and keeps Codex and Claude aligned.
- Impact: Future operating instructions should be updated in docs first.

### 2026-07-03
- Decision: Default both agents to a strict SaaS workflow with explicit read order, approval gates, verification rules, and memory guardrails.
- Why: Sensitive SaaS areas like auth, billing, schema, RLS, and deploys need tighter control than generic agent workflows.
- Impact: Agents should plan earlier, verify more often, and pause before risky changes.

### 2026-07-03
- Decision: Treat project docs as source of truth and session memory as advisory only.
- Why: Session memory can preserve stale architecture, temporary hacks, or incorrect assumptions.
- Impact: Agents must verify remembered context against current docs and files before relying on it.

### 2026-08-16
- Decision: Let a user hold up to `MAX_ACTIVE_MISSIONS` (5) simultaneously active
  missions/goals instead of exactly one; move `day0Date`/`programLength` off `User`
  onto `Mission`; replace the one-active-mission unique index with a race-safe
  advisory-lock trigger; add a `'paused'` mission status ("Отложить").
- Why: Product decision (spec:
  `docs/superpowers/specs/2026-08-09-multi-active-goals-design.md`,
  plan: `docs/superpowers/plans/2026-08-09-multi-active-goals.md`) to let users pursue
  several goals in parallel rather than forcing one-at-a-time.
- Impact: Every call site that assumed a single active mission (bot `/today`,
  onboarding, morning/evening jobs, worker publish captions, all web API routes under
  `apps/web/src/app/api`) was rewired to `getActiveMissions` with an explicit
  per-call-site choice of which mission to use when only one representative value is
  needed (see `docs/ARCHITECTURE.md`'s "Multiple Active Goals" section). Two
  call sites were missed by the original migration pass and fixed as follow-ups on
  the same branch: `apps/bot/src/handlers/evening.ts` (still read
  `user.day0Date`/`plan.mainTaskId`) and `apps/web/src/app/api/settings/route.ts`
  (still read `user.programLength`/`user.day0Date`) — both are a reminder to grep for
  `getActiveMission(` (singular) and `user.day0Date`/`user.programLength` repo-wide
  after any future schema move like this one, not just follow the plan's enumerated
  file list.
