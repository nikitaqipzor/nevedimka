# MEMORY.md

Memory policy for agents and session tooling.

## Source Of Truth
- `PROJECT.md` is the source of truth for project framing.
- `docs/ARCHITECTURE.md` is the source of truth for architecture.
- `docs/DECISIONS.md` is the source of truth for decisions.
- `SECURITY.md` is the source of truth for security rules.

## Allowed Uses
- Recall previous bugs and regressions.
- Recall project vocabulary and recurring workflows.
- Recall durable lessons from completed work.
- Recall common SaaS patterns that still match current docs and code.

## Forbidden Content
- Secrets, API keys, tokens, passwords, private credentials.
- Customer private data or raw production payloads.
- Temporary hacks presented as permanent architecture.
- Unverified assumptions that conflict with current docs.

## Conflict Rule
- If memory conflicts with project docs or current files, trust the docs and files.
- Record the conflict and clean up stale memory if your system supports it.

## Storage Guidance
- Keep reusable lessons in `tasks/lessons.md`.
- Keep durable patterns in `docs/solutions/`.
- Keep architectural decisions in `docs/DECISIONS.md`.
