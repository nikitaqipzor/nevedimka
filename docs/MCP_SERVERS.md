# MCP_SERVERS.md

Inventory of approved MCP servers and connectors for this template.

## Usage Rules
- Prefer read-only access when the server supports it.
- Enable write-capable servers only when the task justifies them.
- High-risk servers require explicit approval for risky actions even if they are connected.
- Pin server versions or sources whenever possible.
- Review server permissions before enabling them in a new project.

## Recommended Baseline

### GitHub MCP
- Purpose: repo context, issues, PRs, reviews, CI, workflows.
- Mode: read-mostly by default; write for PR/review workflows when needed.
- Risks: accidental branch, PR, or workflow changes.
- Approval required for: merges, admin operations, secrets, workflow edits.

### Playwright MCP
- Purpose: UI verification, browser flows, smoke checks, e2e exploration.
- Mode: task-scoped.
- Risks: destructive flows against real environments, flaky runs, token use.
- Approval required for: production-like environments, irreversible flows, account mutations.

### Context7 or Docs MCP
- Purpose: up-to-date library and framework documentation.
- Mode: read-only.
- Risks: low.
- Approval required for: no, unless the environment imposes additional restrictions.

### Supabase MCP or Neon MCP
- Purpose: database context, schema review, SQL inspection, migrations support.
- Mode: read-only by default; write only with explicit task approval.
- Risks: schema damage, data leaks, RLS regressions.
- Approval required for: migrations, DDL, policy changes, production data changes.

### Vercel MCP
- Purpose: projects, deploys, environments, logs, domains, docs.
- Mode: read-mostly.
- Risks: environment misconfiguration, production deploy side effects.
- Approval required for: deploys, env var changes, project config changes.

### Stripe MCP
- Purpose: docs, payments context, product/pricing setup, billing investigation.
- Mode: read-mostly.
- Risks: money movement, customer billing mistakes, webhook breakage.
- Approval required for: live-mode writes, webhook changes, pricing changes, customer-impacting actions.

### Sentry MCP
- Purpose: production error triage, stack traces, regressions, release issues.
- Mode: read-only by default.
- Risks: exposure to sensitive production metadata.
- Approval required for: destructive admin operations if supported.

### Figma MCP
- Purpose: design context, tokens, copy, layout references, component intent.
- Mode: read-only by default.
- Risks: stale designs or accidental coupling to draft work.
- Approval required for: write-back or design mutations if supported.

## Optional Servers
- Serena: targeted code navigation and edits when available.
- DeepWiki: public repository understanding and external codebase research.
- Agentmemory: session recall only; treat as advisory, never source of truth.

## Source Verification Checklist
- Confirm the server source and maintainer.
- Prefer official repos, trusted vendors, or vetted internal forks.
- Record project-specific decisions in `docs/DECISIONS.md`.
- If a server has broad permissions, document why it is enabled.
- Re-check permissions before connecting a server to production resources.
