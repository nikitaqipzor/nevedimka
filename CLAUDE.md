# CLAUDE.md

Strict SaaS operating instructions for Claude Code in this repository.

## Read Order
1. Read `PROJECT.md`.
2. Read `SECURITY.md`.
3. Read `docs/AI_CONTEXT.md`.
4. Read `docs/COMMANDS.md`.
5. Read `docs/ARCHITECTURE.md`.
6. Read `docs/DECISIONS.md`.
7. Read `docs/API_CONTRACTS.md` if the task touches integrations or interfaces.
8. Read `docs/KNOWN_BUGS.md` when debugging or changing risky areas.
9. Read `TASKS.md` for current priorities.
10. Read `tasks/lessons.md` for project-specific mistakes to avoid.
11. Only then open the exact files needed for the task.

## Work Mode
For every non-trivial task:
1. Read relevant project docs first.
2. Find related files before editing.
3. Write a short plan.
4. Ask for confirmation if the change affects architecture, database, auth, billing, deployment, secrets, or production data.
5. Make the smallest safe change.
6. Run checks.
7. Show a diff summary.
8. Update docs if behavior changed.

## Compound Engineering Workflow
- Use Compound Engineering commands selectively, not reflexively.
- `/ce-strategy`: create or refine `STRATEGY.md` for project direction.
- `/ce-brainstorm`: explore feature scope, tradeoffs, and ambiguity.
- `/ce-plan`: create a technical implementation plan.
- `/ce-work`: implement after the plan is clear.
- `/ce-simplify-code`: reduce complexity after the first working pass.
- `/ce-code-review`: review quality, regressions, and risks.
- `/ce-compound`: store durable lessons and decisions after completion.
- Do not use `/lfg` unless the user explicitly approves autonomous execution.

## Plan Mode Default
- Default to planning before implementation for non-trivial work.
- Use plan mode for architectural, database, auth, billing, deployment, or security changes.
- If something goes sideways, stop and re-plan immediately.

## Verification Before Done
- Never mark work complete without proving it works.
- Run relevant tests, lint, typecheck, build, or focused checks when available.
- If checks are skipped, explain why and what remains unverified.

## Demand Elegance
- Prefer the smallest clean solution over the fastest messy one.
- For non-trivial changes, pause and ask whether there is a simpler and more maintainable design.
- Skip over-engineering for trivial fixes.

## Safe Autonomy
- Fix local and safe bugs without hand-holding.
- Ask for confirmation before touching auth, billing, database schema, RLS, deployments, secrets, or production config.
- Do not turn a bugfix into a broad refactor without explicit approval.

## Subagent Policy
- Use subagents selectively for complex architecture, security review, research, or parallel analysis.
- Do not use subagents liberally on small tasks because they consume budget.

## Token & Context Efficiency
- Do not read the entire codebase unless necessary.
- First inspect file names, routes, and relevant folders.
- Read only files directly related to the task.
- Prefer diff-based review over full-project review.
- Use subagents only for complex tasks.
- For simple tasks, avoid brainstorm, plan, and review pipelines.
- Keep `docs/solutions` notes short and reusable.
- Summarize findings before opening more files.
- Stop and ask before expanding scope.

## Workflow Selection
Small task:
- short plan
- minimal edit
- run relevant check

Medium task:
- `/ce-plan`
- `/ce-work`
- `/ce-simplify-code`

Large or risky task:
- `/ce-brainstorm`
- `/ce-plan`
- `/ce-work`
- `/ce-simplify-code`
- `/ce-code-review`
- `/ce-compound`

Avoid `/lfg` unless explicitly approved.

## Forbidden Without Approval
Do not do any of the following without explicit approval:
- Delete files or data.
- Change database schema.
- Modify authentication or authorization.
- Change payment or billing logic.
- Change RLS policies.
- Edit environment variables or secret management.
- Add major dependencies.
- Push to `main`.
- Deploy to production.

## Security Rules
- Never print secrets, tokens, or API keys.
- Never commit secrets.
- Do not change `.env` files without approval.
- Do not disable security checks to make progress faster.

## Database Rules
- Use migrations for schema changes.
- Do not drop fields or tables without confirmation.
- Explain the impact of migrations on existing data.
- Review RLS and access-control effects for every data-layer change.

## Task Management
- Keep session plans in `tasks/todo.md` for multi-step work.
- Record repeated mistakes and user corrections in `tasks/lessons.md`.
- Keep `TASKS.md` as the higher-level project priority list.

## Memory Rules
- Use session memory to recall previous bugs, decisions, and implementation context.
- Treat `PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `SECURITY.md` as the source of truth.
- If memory conflicts with project docs, trust project docs and flag the conflict.
- Do not store secrets, API keys, tokens, passwords, or customer private data in memory.
- Before using remembered context for architecture, auth, billing, database, or security decisions, verify it against current files.

## Documentation Source Of Truth
- Shared project truth lives in `PROJECT.md`, `SECURITY.md`, and `docs/*`.
- Keep this file short, strict, and Claude-specific.
