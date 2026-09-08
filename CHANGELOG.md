# CHANGELOG.md

Track meaningful project changes.

## Template
### YYYY-MM-DD
- Changed:
- Why:
- Impact:

## Entries
### 2026-09-08
- Changed: Added a root-level GitHub Actions workflow configured for the nested npm monorepo and updated core project documentation to describe the actual "Невидимка" product.
- Security: Split restricted user queries and privileged system operations across `DATABASE_URL` and `SYSTEM_DATABASE_URL`, with production fail-fast guards and a Compose-provisioned `NOBYPASSRLS` role.
- Privacy: Account deletion now validates and removes evidence, original video, rendered output, and per-asset work files before cascading database rows; active worker jobs postpone deletion to prevent orphan races.
- Fixed: Telegram video uploads now use the shared video root, and Compose mounts evidence/video storage into every process that reads or deletes those files.
- Tested: Added focused configuration, storage-boundary, recursive-cleanup, and symlink-escape regression tests; expanded the Postgres full-flow deletion scenario.
- Fixed: Removed tracked TypeScript incremental metadata and made `typecheck` build the bot before checking tests that import its compiled output.
- Documented: Recorded the current dependency-audit baseline (10 high, 5 moderate, 0 critical) for a separate reviewed upgrade.
- Why: The previous workflow was not discoverable by GitHub, while the source-of-truth docs still described a generic SaaS template.
- Impact: Pull requests can run the typecheck/build/test pipeline from a clean checkout, and future work starts from accurate architecture, security, command, and backlog context.

### 2026-07-03
- Changed: Added strict SaaS operating docs for Claude Code and Codex, with shared read order and security guardrails.
- Why: Reduce context waste, improve consistency, and make sensitive changes safer.
- Impact: Agents now have a stronger required workflow and shared project memory structure.

### 2026-07-03
- Changed: Added Compound Engineering workflow guidance, `/lfg` restrictions, memory hierarchy rules, `STRATEGY.md`, and `docs/solutions/`.
- Why: Support a disciplined CE workflow without enabling unsafe autonomy or stale memory.
- Impact: Agents now have clearer routing for planning, implementation, review, memory usage, and reusable solution notes.
