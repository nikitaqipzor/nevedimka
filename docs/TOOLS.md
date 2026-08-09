# TOOLS.md

Tooling policy for agents in this template.

## Preferred Tool Order
1. Read project docs first.
2. Use targeted code navigation tools.
3. Use docs tools for up-to-date library behavior.
4. Use browser and environment tools only when the task needs them.
5. Use write-capable infrastructure tools only with explicit scope.

## Tool Roles

### Context7 or Docs MCP
- Use for current library docs before generic web browsing.
- Treat official docs as primary source for technical behavior.

### Serena
- Use for targeted code search and narrow edits when available.
- Prefer this over broad repo scanning.

### Playwright MCP
- Use for UI verification, reproductions, and browser flows.
- Avoid unless the task benefits from real UI interaction.

### GitHub MCP
- Use for PRs, issues, review comments, CI, and workflow context.
- Prefer this over manual GitHub browsing when available.

### Supabase or Neon MCP
- Use for schema review, SQL context, and safe inspection.
- Default to read-only mental model even if write operations exist.

### Vercel MCP
- Use for logs, deployments, project status, and environment visibility.
- Treat deployment operations as high-risk.

### Stripe MCP
- Use for docs and billing context.
- Treat live account changes as high-risk.

### Sentry MCP
- Use for production error investigation and release validation.

### Figma MCP
- Use for design context and component intent.
- Prefer read-only use.

## Fallback Rules
- If a tool or plugin is unavailable, continue with the safest manual workflow.
- Do not block on CE or MCP convenience layers when the task can be completed cleanly without them.
- Record persistent workflow gaps in `docs/solutions/` if they recur.

## Default SaaS Tool Preferences
- Use Context7 before generic search for framework and library docs.
- Use Playwright for meaningful UI validation after frontend changes.
- Use Supabase tooling carefully around schema and RLS.
- Use Vercel and Sentry for post-change production confidence when available.
