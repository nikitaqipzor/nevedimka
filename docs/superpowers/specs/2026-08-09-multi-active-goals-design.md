# Design: Multiple Active Goals (Невидимка)

Status: draft, revised after independent review (see "Review findings and resolutions")
Date: 2026-08-09

## Context

Today the product (`nevidimka/`) hard-codes exactly one active "mission"
(main goal) per user: `packages/db/migrations/008_missions_one_active_per_user.sql`
enforces this with a partial unique index (`status='active'`), and the
bot's `/today` flow, the onboarding "accept mission" step, and the Mini
App's "Путь" screen all assume a single active mission (`getActiveMission`
returns one row or null).

## Goal

Let a user hold several active goals at once (capped at a small number),
switch between / view them separately, and have each goal produce its own
daily task and its own "Путь" (progress) view.

## Decisions made during brainstorming

1. Daily cycle: multiple tasks per day, **one task per active goal** (not
   one shared task list).
2. Cap on simultaneous active goals: a small fixed number (default 5,
   configurable).
3. Mini App "Путь": list of active goals → tapping one opens the existing
   per-goal detail view (milestones/progress), now parameterized by
   `missionId` instead of implicitly "the" active mission.
4. Adding a goal beyond the first: re-run the **full** existing onboarding
   scenario (Day 0 + self-contract + goal capture), not a shortened flow.
5. Hitting the cap while trying to add another goal: **refuse**, and
   prompt the user to complete or pause an existing goal first (list +
   action, not a dead-end message).
6. AI day-planning with multiple active goals: **one AI call plans all
   active goals at once** (new prompt/schema), not N separate calls to the
   existing `planDay` per goal — cheaper and faster for the user, more
   implementation work up front.

## Data model changes

- Drop `uq_missions_one_active_per_user` (migration 008's index).
- Add `'paused'` to the `missions.status` check constraint
  (`draft | active | completed | abandoned | paused`) — this is what
  "отложить" (defer) maps to; distinct from `abandoned` (give up for
  good). Update the TypeScript `MissionStatus` union in
  `packages/shared-types/src/index.ts` to match — this is the only other
  place a mission-status enum is pattern-matched in application code.
- Add a trigger function `enforce_active_mission_limit()` on `missions`
  (`BEFORE INSERT OR UPDATE`): raise if the number of `status='active'`
  rows for `user_id` would exceed `MAX_ACTIVE_MISSIONS` (constant,
  default 5). **Correction from review**: a plain `SELECT count(*)`
  inside the trigger is not a hard guarantee — under READ COMMITTED
  (`withUserContext`'s default, no isolation level set), two concurrent
  transactions for the same user can each see a pre-cap count and both
  pass, unlike migration 008's unique index which is atomic at the
  storage layer regardless of isolation level. The trigger body must
  take `PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text))` (or
  `SELECT id FROM missions WHERE user_id = NEW.user_id FOR UPDATE`)
  *before* running the count check, so concurrent inserts for the same
  user actually serialize against each other.
- `day0_date` and `program_length` move from `users` to `missions`
  (per-mission, not account-wide) — **decision from review**: with
  multiple goals, a global day-0/length made "day N of program" wrong
  for any goal not started on the account's original day 0, and caused
  onboarding for goal #2 to silently overwrite goal #1's displayed
  program length. `dayNumberFor()` (`apps/bot/src/utils/dates.ts`) and
  `milestones.target_day` comparisons (`apps/web/src/app/api/path/route.ts`)
  now key off the specific mission's `day0_date`, not the user's. This
  needs its own migration step moving/copying the existing
  `users.day0_date`/`program_length` values onto each user's current
  mission row, and dropping them from `users` once no code reads them
  from there anymore.
- `tasks.mission_id` already exists (`uuid references missions(id) on
  delete set null`, currently unused as an optional detail) — it becomes
  a required-in-practice link for every task created going forward.
- `daily_plans.main_task_id` (singular FK, set unconditionally by
  `createTask` on every `isMainTask` insert) becomes ambiguous once a
  single daily plan can have N main tasks (one per mission) — it would
  silently hold whichever main task was inserted last. **Resolution**:
  stop writing/reading `main_task_id` for multi-mission plans; every
  caller that currently reads `dailyPlan.mainTaskId` switches to
  filtering `listTasksForPlan(planId)` by `is_main_task` (now expect
  zero-or-more rows, not zero-or-one) or by `mission_id`. Keep the
  column (nullable, unused going forward) rather than dropping it, to
  avoid an unnecessary destructive migration for a column that does no
  harm sitting unused.
- Down-migration required per repo convention
  (`packages/db/migrations/down/0NN_*.sql`).

## Bot changes (apps/bot)

- `packages/db` repository: `getActiveMission(userId): Mission | null` →
  `getActiveMissions(userId): Mission[]`. **Confirmed call site list from
  review (12 total, not the 2 originally assumed)** — every one of these
  needs an explicit decision (switch to the list, or pick "the most
  recently active" for now) during implementation, not just a mechanical
  rename:
  - `apps/bot/src/handlers/today.ts` (both `handleToday` and
    `handleCheckInText`)
  - `apps/bot/src/handlers/onboarding.ts`
  - `apps/bot/src/handlers/content.ts:202`
  - `apps/bot/src/jobs/morning.ts:39`
  - `apps/bot/src/jobs/evening.ts:30`
  - `apps/worker/src/jobs.ts:165`
  - `apps/web/src/app/api/today/route.ts:29,70`
  - `apps/web/src/app/api/skills/route.ts:10`
  - `apps/web/src/app/api/mentor/route.ts:40`
  - `apps/web/src/app/api/path/route.ts:13`
  - `apps/web/src/app/api/content/[id]/route.ts:99`
  - `packages/db/test/rls.test.ts:99-100` asserts singular behavior
    directly and must be updated alongside the repository change, not
    left to bit-rot.
- `/today` (`today.ts`): call a new AI function (see AI section) once
  with all active missions, get back one main task per mission, create
  each task with its `mission_id`. Message groups tasks by goal:
  `🎯 <goal title>: <task title> [Отчитаться]`. The existing per-task
  `report:(taskId)` callback and `handleReportText`/`handleReportMedia`
  need no change — they already operate on a task id, not on "the"
  mission.
- Onboarding (`onboarding.ts`): re-running the full scene (Day 0 +
  self-contract + goal capture — confirmed to stay as a full repeat, not
  shortened) to add a goal must check
  `getActiveMissions(userId).length >= MAX_ACTIVE_MISSIONS` before
  drafting a new mission via AI (skip the AI call entirely if already at
  cap, to avoid wasting AI budget on a mission that can't be saved). If at
  cap, list current active missions with inline "Завершить"/"Отложить"
  buttons instead of proceeding. Because `day0_date`/`program_length`
  move to `missions` (see data model section), this re-run now writes a
  fresh per-mission `day0_date`/`program_length` instead of clobbering
  `users.program_length` — the overwrite bug flagged in review is closed
  by that schema change, not by shortening the flow.
- New entry point to start "add a goal" (command and/or persistent
  keyboard button, consistent with existing `/settings` pattern).

## Mini App changes (apps/web)

- "Путь" screen becomes a list of active-goal cards (title + progress);
  tapping a card routes to the existing detail view, now reading
  `missionId` from the route/query instead of assuming a singleton.
- Each card gets "Завершить" / "Отложить" actions → new
  `PATCH /api/missions/[id]` (status transition, validated).
- `/api/today` route: same grouping-by-`mission_id` logic as the bot,
  kept in sync (currently the two implementations already duplicate
  today's single-mission logic independently — this is an existing
  known gap, not introduced by this change).
- **Scoped from review (previously just "open risks"), now concrete
  tasks:**
  - `apps/web/src/app/api/skills/route.ts:10` derives the skills-map
    directions from the single active mission's `directions` — must
    union directions across all active missions (or let the screen
    filter by mission).
  - `apps/web/src/app/api/mentor/route.ts:40` and the mentor/behavior
    prompt context (`packages/ai/src/roles.ts`, `missionTitle: string`)
    are single-mission-shaped — mentor chat needs either a
    goal-selector or an explicit "which goal is this about" framing when
    multiple are active.
  - `apps/bot/src/handlers/content.ts:202` and
    `apps/web/src/app/api/content/[id]/route.ts:99` (publishing pipeline)
    also call `getActiveMission` — needs a decision on which mission a
    published post is attributed to when several are active (e.g. ask
    the user at post-creation time rather than defaulting silently).

## AI changes (packages/ai)

- New function (e.g. `planDayForMissions`) and zod schema returning an
  array of `{ missionId, task: { title, estimate_minutes, direction } }`,
  one entry per active mission, from a single `callRole` invocation.
- `prompts/day_planner.md` rewritten to accept N goals in its context and
  produce N tasks, instead of one goal → one main task + optional
  extras.
- Rate limiting (`packages/ai/src/rateLimit.ts`) requires no change: this
  is still exactly one `callRole` invocation per `/today`, regardless of
  how many active goals a user has — multiple goals make this cheaper
  relative to today's per-goal-call alternative, not more expensive.

## Testing

- `packages/db/test/migrations.test.ts`: new migration's up/down cycle.
- `packages/db/test/rls.test.ts`: confirm the trigger and multi-mission
  reads still respect per-user isolation.
- `apps/bot/test/full-flow.test.ts`: add a second goal, hit the cap,
  confirm refusal + pause/complete flow frees a slot, `/today` produces
  one task per active goal, report against a non-primary goal's task.
- `apps/web/test/e2e.test.ts`: goal list → detail navigation, "Отложить"
  action, confirm status change persists in DB (not just on screen).

## Review findings and resolutions

This design went through one round of independent review (two
read-only reviewers checking the draft against the actual current code,
no live calls to Telegram/Anthropic/Supabase). Findings and how each was
resolved:

| Finding | Resolution |
|---|---|
| `getActiveMission` has 12 call sites, not the 2 originally assumed | Full list now enumerated in "Bot changes"; each requires an explicit per-call-site decision during implementation, not a mechanical rename |
| Trigger-based cap enforcement has the same TOCTOU race it was meant to fix, under READ COMMITTED | Trigger body now specified to take an advisory lock (or `FOR UPDATE`) on the user before counting — see "Data model changes" |
| `daily_plans.main_task_id` (singular FK) is ambiguous with N main tasks per day | Column left in place but no longer written/read for multi-mission plans; callers switch to filtering `listTasksForPlan` — see "Data model changes" |
| Day-numbering (`users.day0_date`) and `program_length` are account-wide, not per-goal — wrong "day N of X" and mis-flagged milestones for any goal not started on day 0 | **User decision: move both to `missions`** (per-goal) — see "Data model changes" |
| Re-running onboarding for goal #2+ silently overwrote `users.program_length` | Resolved as a side effect of the above per-mission move, not by shortening the onboarding flow |
| Skills map, mentor chat, and the publishing pipeline are single-mission-shaped and were previously listed only as "risks" | Promoted to concrete scoped tasks in "Mini App changes" |
| Full Day-0/self-contract ritual repeating for every additional goal may feel repetitive, since its text reads as "once per person" | **User decision: keep the full repeat as originally chosen** — flagged here as a conscious trade-off, not an oversight, in case product feedback later suggests revisiting it |

No further open risks remain unresolved at the design level; the
remaining "union directions across missions" / "which mission does a
post belong to" decisions are implementation-detail questions to work
out in the implementation plan, not design-blocking.
