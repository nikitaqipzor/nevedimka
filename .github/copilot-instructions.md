# Copilot Instructions

This file is the repo-wide constitution for GitHub Copilot and related agent tooling.

## Read Order
1. `PROJECT.md`
2. `SECURITY.md`
3. `docs/AI_CONTEXT.md`
4. `docs/COMMANDS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`
7. `docs/API_CONTRACTS.md` when relevant
8. `TASKS.md`

## Core Rules
- Prefer small diffs.
- Do not scan the entire repository without a clear reason.
- Reuse existing components, helpers, and patterns first.
- Do not change auth, billing, schema, RLS, deploys, or secrets without a plan and explicit approval.
- Run relevant checks before claiming completion.
- Update docs when behavior or architecture changes.
- Treat `docs/DECISIONS.md` and `SECURITY.md` as hard constraints, not suggestions.

## Context Efficiency
- Read only the files needed for the task.
- Prefer diff-based review over repo-wide review.
- Summarize findings before opening more files.
- Stop and ask before expanding scope on risky work.
