# AGENTS.md

Strict SaaS operating instructions for Codex in this repository.

## Read Order
1. Read `PROJECT.md`.
2. Read `SECURITY.md`.
3. Read `docs/AI_CONTEXT.md`.
4. Read `docs/COMMANDS.md`.
5. Read `docs/ARCHITECTURE.md`.
6. Read `docs/DECISIONS.md`.
7. Read `docs/API_CONTRACTS.md` if the task touches integrations or interfaces.
8. Read `docs/KNOWN_BUGS.md` for debugging or risky areas.
9. Read `TASKS.md` for current priorities.
10. Read `tasks/lessons.md` for project-specific mistakes to avoid.
11. Only then inspect the exact files needed for the task.

## Work Mode
For every non-trivial task:
1. Read the relevant project docs first.
2. Find the related files before editing.
3. Write a short plan.
4. Ask for confirmation if the change affects architecture, database, auth, billing, deployment, secrets, or production data.
5. Make the smallest safe change.
6. Run the smallest relevant checks first, then broader checks if needed.
7. Show a short diff summary.
8. Update docs if behavior, architecture, or workflow changed.

## Compound Engineering Workflow
- Use Compound Engineering workflows selectively, not by default.
- `/ce-strategy`: create or refine `STRATEGY.md` for project direction.
- `/ce-brainstorm`: use for feature exploration, ambiguity reduction, and options.
- `/ce-plan`: use for technical planning before meaningful implementation.
- `/ce-work`: use for implementation after scope and risks are understood.
- `/ce-simplify-code`: use after implementation when code got more complex than necessary.
- `/ce-code-review`: use for quality review on medium, large, or risky work.
- `/ce-compound`: use to save durable lessons and decisions after the work is complete.
- Do not use `/lfg` unless the user explicitly approves autonomous execution.

## Plan Mode Default
- Enter plan mode for any task with 3 or more meaningful steps.
- Enter plan mode for any change involving architecture, migrations, auth, billing, deployment, or security.
- If the plan breaks, stop and re-plan instead of improvising.

## Verification Before Done
- Never claim completion without evidence.
- Run relevant checks whenever possible.
- Compare intended behavior with the actual change.
- If verification cannot be run, say exactly what was not verified.

## Change Discipline
- Prefer targeted search and small diffs.
- Do not scan the entire repository without a clear reason.
- Reuse existing components, helpers, and patterns first.
- Avoid broad refactors unless explicitly requested.
- Do not rewrite large files without a short plan.
- Challenge hacky fixes and prefer the simplest elegant solution.

## Safe Autonomy
- Fix safe, local bugs autonomously when scope is clear.
- Pause for confirmation before touching auth, billing, database schema, RLS, deployments, secrets, or production config.
- Do not silently expand scope from a bug fix into a redesign.

## Subagent Policy
- Use subagents only for complex research, architecture analysis, security review, or parallelizable investigation.
- Do not use subagents for small edits, narrow debugging, or simple file changes.
- Protect context and token budget by keeping the main path simple.

## Token And Context Efficiency
- Do not read the entire codebase unless necessary.
- Inspect file names, routes, and relevant folders first.
- Read only files directly related to the task.
- Prefer diff-based review over full-project review.
- Use subagents only for complex tasks.
- For simple tasks, avoid full brainstorm, plan, and review pipelines.
- Keep `docs/solutions` notes short and reusable.
- Summarize findings before opening more files.
- Stop and ask before expanding scope.

## Workflow Selection
Small task:
- Write a short plan.
- Make the minimal safe edit.
- Run the relevant check.

Medium task:
- Use `/ce-plan`.
- Use `/ce-work`.
- Use `/ce-simplify-code`.

Large or risky task:
- Use `/ce-brainstorm`.
- Use `/ce-plan`.
- Use `/ce-work`.
- Use `/ce-simplify-code`.
- Use `/ce-code-review`.
- Use `/ce-compound`.

- Avoid `/lfg` unless explicitly approved.

## Forbidden Without Approval
Do not do any of the following without explicit approval:
- Delete files or data.
- Change database schema.
- Modify authentication or authorization logic.
- Modify payment or billing logic.
- Change RLS policies.
- Edit environment variables or secrets handling.
- Change deployment or production configuration.
- Add major dependencies.
- Push to `main` or deploy to production.

## Security Rules
- Never print, commit, or expose secrets, tokens, or API keys.
- Do not edit `.env` files without approval.
- Do not weaken security controls to make a test pass.
- Treat auth, billing, and data access as high-risk surfaces.

## Database Rules
- All schema changes must go through migrations.
- Do not delete columns, tables, or policies without explicit approval.
- Explain migration impact on existing data.
- Review RLS and data access implications for every database change.

## Task Management
- Use `tasks/todo.md` for task checklists and progress when work spans multiple steps.
- Use `tasks/lessons.md` after user corrections or repeated mistakes.
- Keep `TASKS.md` focused on current project priorities, not session noise.

## Memory Rules
- Session memory is helpful, but it is not the source of truth.
- `PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `SECURITY.md` are the source of truth.
- If memory conflicts with project docs, trust project docs and flag the conflict.
- Do not store secrets, API keys, tokens, passwords, or private customer data in memory.
- Before using remembered context for architecture, auth, billing, database, or security decisions, verify it against current files.

## Documentation Source Of Truth
- Shared project context lives in `PROJECT.md`, `SECURITY.md`, and `docs/*`.
- Keep this file Codex-specific and process-oriented.
- If rules conflict with project docs, resolve the mismatch by updating the docs intentionally.
