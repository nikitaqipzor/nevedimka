# DECISIONS.md

Record short architectural, workflow, and security decisions here.

## Template
### YYYY-MM-DD
- Decision:
- Why:
- Impact:

## Entries
### 2026-09-08
- Decision: Use `DATABASE_URL` for a `NOBYPASSRLS` application role and `SYSTEM_DATABASE_URL` for migrations and narrowly reviewed cross-user operations; production requires distinct credentials.
- Why: A single privileged pool made RLS defense-in-depth ineffective for request-scoped queries.
- Impact: Deployments must provision both credentials; local development may retain the single-URL fallback outside production.

### 2026-09-08
- Decision: Keep local evidence and video storage in explicit shared roots and delete validated files plus each video asset directory before account-row deletion.
- Why: Database cascades cannot remove filesystem data, and the previous bot video path was invisible to the worker container.
- Impact: Bot/web share evidence storage, bot/worker/web share video storage, and unsafe or symlink-escaped paths abort deletion.

### 2026-09-08
- Decision: Treat `nevidimka/` as the canonical application directory while keeping governance documents at repository root for the current stabilization phase.
- Why: Moving the full monorepo and merging duplicate metadata is higher risk than restoring CI with an explicit working directory.
- Impact: Root automation must set `working-directory: nevidimka`; future flattening requires a separate reviewed change.

### 2026-09-08
- Decision: Stabilization and production safety take priority over new product features.
- Why: CI was not discoverable at repository root, project docs described an unrelated SaaS template, database privilege separation is incomplete, and file deletion is not end-to-end.
- Impact: CI, documentation, RLS credentials, storage deletion, and real deployment smoke tests are the next milestones.

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
