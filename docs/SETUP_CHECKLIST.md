# SETUP_CHECKLIST.md

Use this checklist when cloning the template into a new project.

## Project Identity
- [ ] Rename the project in `PROJECT.md`.
- [ ] Fill in the product summary and target users.
- [ ] Set the current phase and priority.

## Docs
- [ ] Fill `docs/AI_CONTEXT.md`.
- [ ] Fill `docs/COMMANDS.md` with real commands.
- [ ] Fill `docs/ARCHITECTURE.md` once the structure is known.
- [ ] Add first entries to `docs/DECISIONS.md`.
- [ ] Add known risk areas to `docs/KNOWN_BUGS.md` if any already exist.
- [ ] Update `CHANGELOG.md` if the template itself is changed.

## Tooling
- [ ] Choose package manager: `npm`, `pnpm`, `yarn`, or `bun`.
- [ ] Review `docs/MCP_SERVERS.md` and remove anything you will not use.
- [ ] Review `docs/EDITOR_SETUP.md` and sync with your team defaults.
- [ ] Configure `.devcontainer/devcontainer.json` if using Dev Containers.
- [ ] Add project-specific MCP or connector config from `mcp/servers.example.json`.

## Agent Layers
- [ ] Review `AGENTS.md`.
- [ ] Review `CLAUDE.md`.
- [ ] Review `.github/copilot-instructions.md`.
- [ ] Customize `.github/prompts/`, `.github/agents/`, and `.github/instructions/` if needed.

## Security
- [ ] Review `SECURITY.md`.
- [ ] Decide approval policy for auth, billing, schema, deploys, and secrets.
- [ ] Confirm memory policy in `docs/MEMORY.md`.

## Workflow
- [ ] Decide whether Compound Engineering commands are available in this project.
- [ ] Decide whether Agentmemory is enabled.
- [ ] Fill `TASKS.md` with the first 1-3 priorities.
- [ ] Fill `STRATEGY.md` if project direction is already known.
- [ ] Replace all template wording that still says "template" with the actual project language.
