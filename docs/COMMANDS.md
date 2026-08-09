# COMMANDS.md

## Core Commands
- Install dependencies: `pnpm install`
- Start dev server: `pnpm dev`
- Run lint: `pnpm lint`
- Run typecheck: `pnpm typecheck`
- Run tests: `pnpm test`
- Run build: `pnpm build`

## Focused Verification
- Run one test file: `pnpm test -- <path-to-test-file>`
- Run one test name: `pnpm test -- -t "<test name>"`
- Run e2e: `pnpm playwright test`
- Run database migrations: `pnpm supabase db push`
- Seed database: `pnpm seed`

## Verification Order
1. Run the smallest relevant command first.
2. Run broader checks if the change touches shared or risky areas.
3. For auth, billing, schema, or deployment changes, prefer targeted verification plus at least one broader check.

## Notes
- Replace placeholders with real commands as soon as the stack is initialized.
- Agents should not say "done" without running the relevant commands or clearly stating what could not be run.
- If the project later uses `npm` instead of `pnpm`, update this file immediately after cloning.
