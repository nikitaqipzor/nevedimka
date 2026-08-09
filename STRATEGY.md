# STRATEGY.md

Project strategy for product and engineering direction.

## Vision
Provide a reusable SaaS starter that gives Claude, Codex, Copilot, and MCP-based workflows the same safe operating model from day one.

## Current Objective
Reduce setup time for new SaaS repositories while keeping risky surfaces like auth, billing, RLS, migrations, and deploys under control.

## Constraints
- Team size: assume solo founder or small product team
- Time horizon: optimize for fast startup with sane defaults
- Technical limits: avoid overbuilding before product-specific needs are known
- Compliance or security limits: treat auth, money, data access, and secrets as high-risk by default

## Priorities
1. Make the template easy to copy and rename for a new product
2. Keep the agent workflow safe, explicit, and low-noise
3. Support a standard modern SaaS stack without forcing unnecessary complexity

## Anti-Goals
- Building a full boilerplate app inside the docs layer
- Allowing autonomous risky production changes by default
- Letting memory or tools override source-of-truth project docs

## Notes For Compound Engineering
- Use `/ce-strategy` to update this file when direction changes materially.
- Keep this file strategic, not implementation-heavy.
