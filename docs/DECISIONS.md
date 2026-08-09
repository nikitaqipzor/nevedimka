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
