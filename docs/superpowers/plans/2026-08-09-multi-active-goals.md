# Multiple Active Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user hold up to `MAX_ACTIVE_MISSIONS` (default 5) simultaneously active missions, each with its own day-0/program-length, daily main task, and "Путь" progress view, replacing every single-active-mission assumption in `packages/db`, `apps/bot`, `apps/worker`, `apps/web`, and `packages/ai`.

**Architecture:** Migration 011 drops the one-active-mission unique index, adds `'paused'` status, moves `day0_date`/`program_length` onto `missions`, and adds a race-safe advisory-lock trigger enforcing the cap. `getActiveMission` becomes `getActiveMissions` (array) with every call site given an explicit per-site decision. `/today` gains a new AI function (`planDayForMissions`) that plans all active missions in one `callRole` call and creates one main task per mission. The Mini App "Путь" screen becomes a goal list with a detail view keyed by `missionId`.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), PostgreSQL (raw SQL migrations, `pg` client), grammY (Telegram bot), Next.js App Router (API routes), Zod, Anthropic SDK via `@nevidimka/ai`.

Spec: `docs/superpowers/specs/2026-08-09-multi-active-goals-design.md`

---

## Task ordering rationale

Schema and types must land before any code reads/writes them. Repository functions must land before bot/web callers. AI schema/prompt must land before the `/today` rewire. Each task is independently committable and (mostly) independently testable, but tasks 1-5 are a hard prerequisite chain for everything after.

---

### Task 1: Migration 011 — schema changes

**Files:**
- Create: `packages/db/migrations/011_multi_active_missions.sql`
- Create: `packages/db/migrations/down/011_multi_active_missions.sql`

- [ ] **Step 1: Write the up migration**

```sql
-- Enables multiple simultaneously-active missions per user.
-- See docs/superpowers/specs/2026-08-09-multi-active-goals-design.md

-- 1. Drop the one-active-mission invariant from 008.
drop index if exists uq_missions_one_active_per_user;

-- 2. Add 'paused' status ("отложить"), distinct from 'abandoned'.
alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check
  check (status in ('draft', 'active', 'completed', 'abandoned', 'paused'));

-- 3. Move day0_date / program_length onto missions (per-goal, not account-wide).
alter table missions add column day0_date date;
alter table missions add column program_length smallint check (program_length in (180, 365));

-- Backfill: every existing mission inherits its owner's current values.
update missions m
set day0_date = u.day0_date,
    program_length = u.program_length
from users u
where m.user_id = u.id;

alter table missions alter column day0_date set not null;
alter table missions alter column day0_date set default current_date;
alter table missions alter column program_length set not null;
alter table missions alter column program_length set default 180;

-- users.day0_date / users.program_length are no longer read once this ships
-- (see Tasks 8-16). Dropped here per repo convention of not leaving dead
-- columns that could silently diverge from the per-mission source of truth.
alter table users drop column day0_date;
alter table users drop column program_length;

-- 4. Race-safe cap enforcement.
-- max_active below must be kept in sync by hand with
-- MAX_ACTIVE_MISSIONS in packages/shared-types/src/index.ts (Task 3) —
-- triggers can't import a TS constant.
-- A plain COUNT(*) inside a BEFORE trigger is not a hard guarantee under
-- READ COMMITTED: two concurrent inserts for the same user can each see a
-- pre-cap count and both pass. Serialize with an advisory xact lock on the
-- user_id before counting.
create or replace function enforce_active_mission_limit()
returns trigger as $$
declare
  active_count integer;
  max_active constant integer := 5;
begin
  if new.status = 'active' then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));

    select count(*) into active_count
    from missions
    where user_id = new.user_id
      and status = 'active'
      and id is distinct from new.id;

    if active_count >= max_active then
      raise exception 'active mission cap (%) exceeded for user %', max_active, new.user_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_active_mission_limit on missions;
create trigger trg_enforce_active_mission_limit
  before insert or update on missions
  for each row
  execute function enforce_active_mission_limit();
```

- [ ] **Step 2: Write the down migration**

Rollback caveat (accepted, document it in the migration comment): once a user
has used the multi-active-goal feature, `users.day0_date`/`program_length`
cannot losslessly represent per-mission state again — the down migration
picks a single deterministic value per user (most-recently-created mission,
any status) rather than silently defaulting or nondeterministically
"last write wins" across a multi-row UPDATE.

```sql
-- Reverses 011_multi_active_missions.sql.
-- CAVEAT: if any user has more than one mission, or their only missions are
-- not 'active', this collapses back to one row per user using the most
-- recently created mission regardless of status (best-effort, not lossless
-- — multi-active-goal state cannot be represented on a single-row users
-- table). Documented here rather than silently defaulting.
drop trigger if exists trg_enforce_active_mission_limit on missions;
drop function if exists enforce_active_mission_limit();

alter table users add column day0_date date not null default current_date;
alter table users add column program_length smallint not null default 180
  check (program_length in (180, 365));

update users u
set day0_date = latest.day0_date,
    program_length = latest.program_length
from (
  select distinct on (user_id) user_id, day0_date, program_length
  from missions
  order by user_id, created_at desc
) latest
where latest.user_id = u.id;

alter table missions drop column if exists day0_date;
alter table missions drop column if exists program_length;

alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check
  check (status in ('draft', 'active', 'completed', 'abandoned'));

create unique index if not exists uq_missions_one_active_per_user
  on missions(user_id) where status = 'active';
```

- [ ] **Step 3: Run migration up/down locally**

Run: `pnpm --filter @nevidimka/db migrate:up` then `pnpm --filter @nevidimka/db migrate:down` then `migrate:up` again (use whatever scripts `packages/db/src/migrate.ts` exposes — check `package.json` scripts first).
Expected: both directions apply cleanly against the dev DB, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/011_multi_active_missions.sql packages/db/migrations/down/011_multi_active_missions.sql
git commit -m "db: migration 011 - multi-active missions schema"
```

---

### Task 2: `packages/db/test/migrations.test.ts` — cover 011

**Files:**
- Modify: `packages/db/test/migrations.test.ts`

- [ ] **Step 1:** Read the existing test's pattern for prior migrations (it likely loops all migration files and runs up/down/up). Confirm 011 is picked up automatically by filename glob; if the test hardcodes a migration count or list, add 011 explicitly.
- [ ] **Step 2: Run the test suite**

Run: `pnpm --filter @nevidimka/db test`
Expected: PASS, including migration 011's up/down cycle.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/migrations.test.ts
git commit -m "test: cover migration 011 up/down cycle"
```

---

### Task 3: `packages/shared-types` — types

**Files:**
- Modify: `packages/shared-types/src/index.ts:26` (`MissionStatus`)
- Modify: `packages/shared-types/src/index.ts:28-37` (`Mission`)
- Modify: `packages/shared-types/src/index.ts:12-24` (`User`)

- [ ] **Step 1: Update `MissionStatus`**

```ts
export type MissionStatus = "draft" | "active" | "completed" | "abandoned" | "paused";
```

- [ ] **Step 2: Add `day0Date`/`programLength` to `Mission`, remove from `User`**

```ts
export interface Mission {
  id: UUID;
  userId: UUID;
  title: string;
  description?: string;
  directions: string[];
  commitmentText: string;
  status: MissionStatus;
  day0Date: ISODateString;
  programLength: ProgramLength;
  createdAt: ISODateTimeString;
}
```

Remove `day0Date: ISODateString;` and `programLength: ProgramLength;` from `User` (lines 17-18). `ProgramLength` type stays as-is, just moves which interface references it.

- [ ] **Step 3: Add the `MAX_ACTIVE_MISSIONS` constant**

```ts
export const MAX_ACTIVE_MISSIONS = 5;
```

Add near the `MissionStatus`/`Mission` definitions. This is the single source of truth `apps/bot` (Task 8) imports from `@nevidimka/shared-types`. The SQL trigger's `max_active` (Task 1) stays a literal in SQL since triggers can't import TS constants — Task 1's migration comment cross-references this constant so the two are kept in sync manually.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nevidimka/shared-types typecheck` (or repo-wide `pnpm typecheck` — expect cascading errors in `db`/`bot`/`web`/`ai`, which is expected at this point; fixed in later tasks).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/index.ts
git commit -m "types: move day0Date/programLength from User to Mission, add paused status"
```

---

### Task 4: `packages/db/src/repository.ts` — repository layer

**Files:**
- Modify: `packages/db/src/repository.ts` (`mapMission`, `mapUser`, `getActiveMission` → `getActiveMissions`, `createMission`, `createTask`, `setProgramLength`)

- [ ] **Step 1: Update `mapMission` to read `day0_date`/`program_length`; update `mapUser` to stop reading them**

```ts
// mapMission (was lines 55-66) — add:
function mapMission(row: any): Mission {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description ?? undefined,
    directions: row.directions,
    commitmentText: row.commitment_text,
    status: row.status,
    day0Date: row.day0_date,
    programLength: row.program_length,
    createdAt: row.created_at,
  };
}
```

Remove `day0Date`/`programLength` fields from `mapUser`'s return object.

- [ ] **Step 2: Replace `getActiveMission` with `getActiveMissions`**

```ts
export async function getActiveMissions(userId: string): Promise<Mission[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from missions where user_id = $1 and status = 'active' order by created_at asc",
      [userId]
    );
    return r.rows.map(mapMission);
  });
}
```

(Ordered ascending — oldest-first — so "most recently active" call sites that need a single pick can consistently take the *last* element, and new goals append to the end of any list UI.)

- [ ] **Step 3: `createMission` accepts `day0Date`/`programLength`**

Update the params object and INSERT to include `day0_date`, `program_length` (caller-supplied, defaulting to `current_date`/180 only via the column defaults if omitted — but bot/web call sites will always pass them explicitly per Task 8). Let the DB trigger (`enforce_active_mission_limit`) be the cap enforcement; do not duplicate a count check in this function — a duplicate app-level check would just reintroduce the TOCTOU race the trigger closes.

- [ ] **Step 4: `createTask` — stop the unconditional `main_task_id` write**

```ts
export async function createTask(params: {
  userId: string;
  dailyPlanId?: string;
  missionId?: string;
  title: string;
  isMainTask?: boolean;
  estimateMinutes?: number;
  direction?: string;
}): Promise<Task> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into tasks (user_id, daily_plan_id, mission_id, title, is_main_task, estimate_minutes, direction)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [
        params.userId,
        params.dailyPlanId ?? null,
        params.missionId ?? null,
        params.title,
        params.isMainTask ?? false,
        params.estimateMinutes ?? null,
        params.direction ?? null,
      ]
    );
    return mapTask(r.rows[0]);
    // main_task_id is intentionally no longer written here — see
    // listTasksForPlan / callers filtering by is_main_task instead.
    // Column kept on daily_plans (nullable, unused) per spec decision.
  });
}
```

- [ ] **Step 5: Remove or repurpose `setProgramLength`**

`users.program_length` no longer exists after migration 011. Delete `setProgramLength` (lines 216-226) entirely — per-mission `program_length` is now set once at `createMission` time and never updated afterward (no spec requirement to edit it post-creation).

- [ ] **Step 6: Add `updateMissionStatus`**

This is the single canonical home for this function — Task 8 (onboarding cap menu) and Task 17 (`PATCH /api/missions/[id]`) both call it; neither of those tasks defines it.

```ts
const VALID_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  active: ["completed", "abandoned", "paused"],
  paused: ["active", "abandoned"],
  draft: ["active", "abandoned"],
  completed: [],
  abandoned: [],
};

export async function updateMissionStatus(
  userId: string,
  missionId: string,
  status: MissionStatus
): Promise<Mission | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "update missions set status = $3 where id = $1 and user_id = $2 returning *",
      [missionId, userId, status]
    );
    return r.rowCount ? mapMission(r.rows[0]) : null;
  });
}
```

`VALID_TRANSITIONS` is exported alongside it so Task 17's route handler can reuse it for the 409 check without redefining it.

- [ ] **Step 7: Run db package tests**

Run: `pnpm --filter @nevidimka/db test`
Expected: fails only at `rls.test.ts:99-100` (fixed in Task 5) and any test still calling `setProgramLength`/`getActiveMission` by old name — fix those references now if the test file isn't `rls.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/repository.ts
git commit -m "db: getActiveMissions, per-mission day0Date/programLength, main_task_id, updateMissionStatus"
```

---

### Task 5: `packages/db/test/rls.test.ts` — update for array return

**Files:**
- Modify: `packages/db/test/rls.test.ts:99-100`

- [ ] **Step 1: Replace singular assertions**

```ts
  // Basic read isolation
  const missionsA = await db.getActiveMissions(userA.id);
  const missionsB = await db.getActiveMissions(userB.id);
  assert.equal(missionsA.length, 1);
  assert.equal(missionsB.length, 1);
  assert.equal(missionsA[0].title, "Mission A");
  assert.equal(missionsB[0].title, "Mission B");
```

- [ ] **Step 2: Add a multi-mission RLS case**

Add a second mission for `userA` (status `'active'`) via `db.createMission`, confirm `getActiveMissions(userA.id)` returns both and still excludes any of `userB`'s missions — this is the multi-mission-shaped regression the spec calls for ("confirm the trigger and multi-mission reads still respect per-user isolation").

- [ ] **Step 3: Add a cap-trigger test**

Insert `MAX_ACTIVE_MISSIONS` (5) active missions for one user (reuse `createMission`), assert the 6th insert attempt rejects (`assert.rejects(...)`) with the trigger's error. This directly exercises Task 1's advisory-lock trigger logic (sequential inserts are enough to prove the count check; true concurrency isn't practical to assert deterministically in this suite, but sequential coverage still catches an off-by-one in the cap).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @nevidimka/db test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/test/rls.test.ts
git commit -m "test: cover multi-mission RLS isolation and active-mission cap trigger"
```

---

### Task 6: `packages/ai` — `planDayForMissions` + prompt rewrite

**Files:**
- Modify: `packages/ai/src/schemas.ts` (new schema alongside `DayPlannerOutputSchema`)
- Modify: `packages/ai/src/roles.ts` (new `planDayForMissions`, update `chatWithMentor`'s context type)
- Modify: `packages/ai/prompts/day_planner.md`

- [ ] **Step 1: New schema**

```ts
export const MultiMissionDayPlannerOutputSchema = z.union([
  z.object({
    plans: z
      .array(
        z.object({
          mission_id: z.string(),
          summary: z.string(),
          main_task: z.object({
            title: z.string(),
            estimate_minutes: z.number().int().positive(),
            direction: z.string().nullable(),
          }),
          reasoning_note: z.string(),
        })
      )
      .min(1),
  }),
  z.object({ error: z.literal("no_active_mission") }),
]);
export type MultiMissionDayPlannerOutput = z.infer<typeof MultiMissionDayPlannerOutputSchema>;
```

(Deliberately no per-mission `additional_tasks` — the spec's "one task per active goal" decision means one main task per mission, no extras; keeps the prompt/schema simpler than the old single-mission shape which allowed up to 2 extras.)

- [ ] **Step 2: `planDayForMissions` in `roles.ts`**

```ts
export interface DayPlannerForMissionsInput {
  userFirstName: string;
  checkIn: { sleepQuality?: number; energy?: number; mood?: number; stress?: number };
  missions: Array<{
    missionId: string;
    missionTitle: string;
    directions: string[];
    dayNumber: number;
    programLength: number;
    yesterdayMainTaskTitle?: string;
    yesterdayCompletionPercent?: number | null;
  }>;
}

export async function planDayForMissions(
  input: DayPlannerForMissionsInput,
  userId: string
): Promise<{ output: MultiMissionDayPlannerOutput } & RoleCallMeta> {
  const result = await callRole({
    systemPrompt: loadPrompt("day_planner"),
    input,
    userId,
  });
  const output = parseRoleOutput("planDayForMissions", MultiMissionDayPlannerOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
}
```

Leave the old `planDay`/`DayPlannerInput`/`DayPlannerOutputSchema` in place for now — Task 7 Step 6 (not this task) is the pinned deletion point: once Task 7 rewires `buildGeneratedPlanMessage` to call `planDayForMissions` and no code calls `planDay` anymore, Task 7 Step 6 deletes `planDay`/`DayPlannerInput`/`DayPlannerOutputSchema` from `roles.ts`/`schemas.ts` as part of its own commit.

- [ ] **Step 3: Rewrite `day_planner.md`**

Update the prompt to describe: input now contains a `missions` array (each with its own `dayNumber`/`programLength`/`directions`/yesterday context), output must be `{ plans: [{ mission_id, summary, main_task, reasoning_note }, ...] }` with exactly one entry per input mission, `mission_id` copied verbatim from input so the caller can match output back to the right mission. Keep the existing tone/persona guidance from the current file; only the input/output contract sections change.

- [ ] **Step 4: Manual smoke check of prompt against schema**

No live AI call in this task (repo convention: no live Anthropic calls in tests per spec's review process). Re-read the rewritten prompt against `MultiMissionDayPlannerOutputSchema` line by line to confirm every required field is described.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/schemas.ts packages/ai/src/roles.ts packages/ai/prompts/day_planner.md
git commit -m "ai: add planDayForMissions - one call plans all active missions"
```

---

### Task 7: `apps/bot/src/handlers/today.ts` — multi-mission `/today`

**Files:**
- Modify: `apps/bot/src/handlers/today.ts` (`handleToday`, `handleCheckInText`, `buildExistingPlanMessage`, `buildGeneratedPlanMessage`)

- [ ] **Step 1: `handleToday` — fetch `getActiveMissions`, gate on empty array**

Replace `const [user, mission] = await Promise.all([getUserById(userId), getActiveMission(userId)]);` with `getActiveMissions(userId)`; replace `if (!mission)` with `if (missions.length === 0)`. `dayNumberFor` can no longer be computed once for the whole plan — compute per-mission inside the message builders using each `mission.day0Date`.

- [ ] **Step 2: Replace the `plan.mainTaskId` gate**

`plan.mainTaskId` is ambiguous with N main tasks (Task 4, Step 4 stopped writing it). Replace the "already planned" check in `handleToday` and `handleCheckInText` with:

```ts
const existingMainTasks = await listTasksForPlan(userId, plan.id);
const mainTasks = existingMainTasks.filter((t) => t.isMainTask);
if (mainTasks.length > 0) {
  const msg = await buildExistingPlanMessage(userId, plan, mainTasks, missions);
  await ctx.reply(msg.text, { reply_markup: msg.keyboard });
  return;
}
```

- [ ] **Step 3: Rewrite `buildExistingPlanMessage` to group by goal**

Accept `mainTasks: Task[]` and `missions: Mission[]`; build one line per task: `🎯 <mission.title>: <task.title> [Отчитаться]` with the existing per-task `report:(taskId)` callback unchanged (spec confirms no change needed there).

- [ ] **Step 4: Rewrite `buildGeneratedPlanMessage` to call `planDayForMissions`**

```ts
const { output } = await planDayForMissions(
  {
    userFirstName: user.firstName,
    checkIn: plan.checkIn!,
    missions: await Promise.all(
      missions.map(async (m) => {
        const dayNumber = dayNumberFor(m.day0Date, today);
        const recent = await getRecentPlans(userId, 1); // TODO: per-mission recent-task lookup, see note below
        return {
          missionId: m.id,
          missionTitle: m.title,
          directions: m.directions,
          dayNumber,
          programLength: m.programLength,
        };
      })
    ),
  },
  userId
);
if ("error" in output) {
  await ctx.reply("Не смог спланировать день, попробуй /today ещё раз.");
  return { text: "", keyboard: undefined }; // adjust to existing error-handling shape in file
}
for (const p of output.plans) {
  await createTask({
    userId,
    dailyPlanId: plan.id,
    missionId: p.mission_id,
    title: p.main_task.title,
    isMainTask: true,
    estimateMinutes: p.main_task.estimate_minutes,
    direction: p.main_task.direction ?? undefined,
  });
}
```

Note: `getRecentPlans` today returns whole `DailyPlan` rows (single-mission-shaped `mainTaskId`), not per-mission task history — computing accurate `yesterdayMainTaskTitle`/`yesterdayCompletionPercent` per mission requires joining yesterday's plan's tasks filtered by `mission_id`. Add a small repository helper `getYesterdayTaskForMission(userId, missionId, date)` in Task 4 if precise yesterday-context matters for prompt quality; otherwise omit those two optional fields for now and flag as a follow-up (does not block correctness, only prompt richness).

- [ ] **Step 5: `handleCheckInText`** — same `getActiveMissions`/empty-array gate as Step 1.

- [ ] **Step 6: Delete the now-unused single-mission `planDay`**

Confirm no remaining callers of `planDay` (grep `planDay(` across `apps/bot`, `apps/web`). Delete `planDay`, `DayPlannerInput` from `packages/ai/src/roles.ts` and `DayPlannerOutputSchema`, `DayPlannerOutput` from `packages/ai/src/schemas.ts` — this is the pinned deletion point noted in Task 6 Step 2.

- [ ] **Step 7: Run bot tests**

Run: `pnpm --filter @nevidimka/bot test`
Expected: existing single-mission tests fail until Task-19's `full-flow.test.ts` update; note failures, do not fix test expectations in this task (Task 19 owns that).

- [ ] **Step 8: Commit**

```bash
git add apps/bot/src/handlers/today.ts packages/ai/src/roles.ts packages/ai/src/schemas.ts
git commit -m "bot: /today plans and reports one main task per active mission"
```

---

### Task 8: `apps/bot/src/handlers/onboarding.ts` — cap-aware "add a goal"

**Files:**
- Modify: `apps/bot/src/handlers/onboarding.ts` (`startOnboarding`, `handleMissionAccept`)

- [ ] **Step 1: `startOnboarding` — check cap, not existence**

Replace the "already have an active mission → refuse" branch with:

```ts
const activeMissions = await getActiveMissions(userId);
if (activeMissions.length >= MAX_ACTIVE_MISSIONS) {
  await replyWithCapReachedMenu(ctx, activeMissions); // new helper, Step 3
  return;
}
```

Import `MAX_ACTIVE_MISSIONS` from `@nevidimka/shared-types` (added in Task 3 Step 3).

- [ ] **Step 2: Skip the AI draft call at cap**

Confirm the cap check happens *before* `draftMission` is invoked (in `handleDirectionsDone`, not `handleMissionAccept`) so a user already at cap never triggers a wasted AI call. Add the same `getActiveMissions(userId).length >= MAX_ACTIVE_MISSIONS` guard at the top of `handleDirectionsDone`.

- [ ] **Step 3: `replyWithCapReachedMenu` helper**

```ts
async function replyWithCapReachedMenu(ctx: BotContext, missions: Mission[]): Promise<void> {
  const lines = missions.map((m) => `• ${m.title}`).join("\n");
  const keyboard = new InlineKeyboard();
  for (const m of missions) {
    keyboard.text(`Завершить: ${m.title}`, `mission_complete:${m.id}`).row();
    keyboard.text(`Отложить: ${m.title}`, `mission_pause:${m.id}`).row();
  }
  await ctx.reply(
    `У тебя уже ${missions.length} активных целей — это максимум:\n${lines}\n\nЗаверши или отложи одну, чтобы добавить новую.`,
    { reply_markup: keyboard }
  );
}
```

Wire `mission_complete:` / `mission_pause:` callback handlers, calling `updateMissionStatus(userId, missionId, status)` (added in Task 4 Step 6 — do not redefine it here).

- [ ] **Step 4: `handleMissionAccept` — remove the singular re-check, keep cap re-check**

Replace the `getActiveMission(userId)` re-check (race-mitigation comment lines 133-138) with `getActiveMissions(userId).length >= MAX_ACTIVE_MISSIONS` — the DB trigger from Task 1 is now the hard guarantee, so this app-level re-check is a UX nicety (avoid drafting a mission via AI that will fail at insert), not the safety net. Update the accompanying comment to say so.

- [ ] **Step 5: Write per-mission `day0_date`/`program_length` instead of `setProgramLength`**

Replace `await setProgramLength(userId, onboardingDraft.programLength);` (old line 157) with passing `day0Date: todayInTimezone(user.timezone)` (or equivalent "today" value — confirm timezone source available in this handler's scope) and `programLength: onboardingDraft.programLength` directly into the `createMission(...)` call that follows.

- [ ] **Step 6: New entry point to start "add a goal"**

Add a command (e.g. `/addgoal`) and/or persistent keyboard button consistent with the existing `/settings` pattern — find how `/settings` is registered (likely `apps/bot/src/index.ts` or a `commands.ts`) and mirror it, routing to `startOnboarding`.

- [ ] **Step 7: Run bot tests, commit**

```bash
git add apps/bot/src/handlers/onboarding.ts apps/bot/src/index.ts
git commit -m "bot: cap-aware add-a-goal flow with pause/complete menu at limit"
```

---

### Task 9: `apps/bot/src/jobs/morning.ts` and `evening.ts`

**Files:**
- Modify: `apps/bot/src/jobs/morning.ts:39` (`sendMorningPing`)
- Modify: `apps/bot/src/jobs/evening.ts:30` (`sendEveningPing`)

- [ ] **Step 1: `morning.ts`** — `getActiveMissions(user.id)`, `if (missions.length === 0) return;`. `dayNumberFor` must move inside a per-mission loop (there's no longer one `dayNumber` for the whole ping). Reuse Task 7's `buildExistingPlanMessage`/`buildGeneratedPlanMessage` signatures (now multi-mission-aware) instead of the old single-mission calls at lines matching the old `mission` variable.
- [ ] **Step 2: `evening.ts`** — same `getActiveMissions` swap; replace `if (!plan.mainTaskId) return;` with the `listTasksForPlan` + `filter(isMainTask)` check from Task 7 Step 2 (`if (mainTasks.length === 0) return;`).
- [ ] **Step 3: Run bot tests, commit**

```bash
git add apps/bot/src/jobs/morning.ts apps/bot/src/jobs/evening.ts
git commit -m "bot: morning/evening jobs handle multiple active missions"
```

---

### Task 10: `apps/worker/src/jobs.ts` — publish caption

**Files:**
- Modify: `apps/worker/src/jobs.ts:165-170`

- [ ] **Step 1:** Replace `getActiveMission(asset.userId)` with `getActiveMissions(asset.userId)`. `user.day0Date` no longer exists after Task 3, so there is no account-wide fallback when no mission is active — if `missions` is empty, omit the day-number line entirely instead of computing one:

```ts
const missions = await getActiveMissions(asset.userId);
const captionHtml =
  missions.length > 0
    ? `<b>День ${dayNumberFor(missions[missions.length - 1].day0Date, today)} из ${missions[missions.length - 1].programLength}</b>`
    : "";
```

Uses "most recently active" (last element, per Task 4's ascending order) as the caption's reference mission when one or more are active — an explicit per-call-site decision per the spec's requirement, not a silent default.

- [ ] **Step 2: Run worker tests, commit**

```bash
git add apps/worker/src/jobs.ts
git commit -m "worker: publish caption uses most-recently-active mission's day number"
```

---

### Task 11: `apps/bot/src/handlers/content.ts` — publish attribution

**Files:**
- Modify: `apps/bot/src/handlers/content.ts:202` (`handlePostPublish`)

- [ ] **Step 1:** Read the full function (research report notes downstream usage wasn't fully visible) to see whether `mission.id`/`mission.title` is used past line 202. If a draft already carries its own `missionId` from creation time (check `getContentDraft`/`ContentDraft` type), prefer attributing the post to that draft's mission and drop the `getActiveMission(s)` call entirely — this is likely the correct fix and avoids the "which mission" ambiguity altogether. If the draft has no `missionId` today, this is a data-model gap: add `mission_id` to whatever table backs content drafts (new migration) and set it at draft-creation time (ask the user which goal, per spec's suggested resolution), then read it back here.
- [ ] **Step 2:** If adding `mission_id` to drafts is out of scope for this pass, the minimal interim fix is: replace `getActiveMission` with `getActiveMissions`, and if `missions.length > 1`, prompt the user to pick one via inline keyboard before publishing (mirrors Task 8's menu pattern) rather than silently picking one.
- [ ] **Step 3: Run bot tests, commit**

```bash
git add apps/bot/src/handlers/content.ts
git commit -m "bot: publish flow attributes post to an explicit mission when multiple are active"
```

---

### Task 12: `apps/web/src/app/api/today/route.ts`

**Files:**
- Modify: `apps/web/src/app/api/today/route.ts` (`GET` lines 27-48, `POST` checkin case lines 58-259)
- Modify: `apps/web/src/app/today/page.tsx` (or wherever this route's response is consumed — confirm exact path via Explore before starting; it is in scope for this task, not a follow-up)

- [ ] **Step 1:** Mirror Task 7's bot changes: `getActiveMissions`, `mainTasks` via `listTasksForPlan` filter, `planDayForMissions` call, one `createTask` per plan entry with `missionId`.
- [ ] **Step 2:** Response JSON shape changes from a single `mission`/`task` to a `missions`/`tasks` array — update the frontend consumer in the same commit so the two don't drift, per the spec's note that bot and web already duplicate this logic independently.
- [ ] **Step 3: Run web tests, commit**

```bash
git add apps/web/src/app/api/today/route.ts apps/web/src/app/today/
git commit -m "web: /api/today plans and returns one task per active mission"
```

---

### Task 13: `apps/web/src/app/api/skills/route.ts` — union directions

**Files:**
- Modify: `apps/web/src/app/api/skills/route.ts:10`

- [ ] **Step 1:**

```ts
const [missions, progress] = await Promise.all([
  getActiveMissions(session.userId),
  getSkillsProgress(session.userId),
]);

const allDirections = new Set(missions.flatMap((m) => m.directions));
const seen = new Set(progress.map((p) => p.direction));
const withEmpty = [
  ...progress,
  ...[...allDirections]
    .filter((d) => !seen.has(d))
    .map((direction) => ({ direction, totalTasks: 0, doneTasks: 0, completionPercent: 0 })),
];
```

- [ ] **Step 2: Run web tests, commit**

```bash
git add apps/web/src/app/api/skills/route.ts
git commit -m "web: skills map unions directions across all active missions"
```

---

### Task 14: `apps/web/src/app/api/mentor/route.ts` — goal framing

**Files:**
- Modify: `apps/web/src/app/api/mentor/route.ts:40`
- Modify: `packages/ai/src/roles.ts` (`MentorChatInput.context`, ~line 142)

- [ ] **Step 1:** Change `getActiveMission` → `getActiveMissions`. Decide framing per spec ("goal-selector or explicit 'which goal' framing"): simplest correct option is to require the client to pass a `missionId` query/body param when multiple missions are active, defaulting to the single mission when only one exists (no selector needed in the common case).
- [ ] **Step 2:** Update `MentorChatInput.context` in `packages/ai/src/roles.ts` from `missionTitle: string` to accept either a single mission's context (unchanged shape) or, when no `missionId` is specified and multiple are active, a list summary (`activeMissionTitles: string[]`) so the mentor prompt can still respond sensibly without forcing a selection on every message.
- [ ] **Step 3:** Update `apps/web/src/app/mentor/page.tsx` (or wherever the chat UI lives) to send `missionId` when the user has picked a goal context, if a UI selector is added — check whether this is in scope for this plan or a follow-up; if the Mini App page doesn't already have a goal-switcher affordance, adding one is UI work best scoped separately. For this plan, ship the API-level `missionId` param support and default-to-summary behavior; flag the UI selector as a follow-up task, not silently implement a partial one.
- [ ] **Step 4: Run web/ai tests, commit**

```bash
git add apps/web/src/app/api/mentor/route.ts packages/ai/src/roles.ts
git commit -m "web/ai: mentor chat accepts explicit missionId, falls back to multi-goal summary"
```

---

### Task 15: `apps/web/src/app/api/path/route.ts` — goal list + per-mission detail

**Files:**
- Modify: `apps/web/src/app/api/path/route.ts` (`GET`)
- Check/modify: `apps/web/src/app/path/page.tsx` and its detail sub-route (find via Explore if not already known)

- [ ] **Step 1:** Support two modes: no `missionId` query param → return the list of active missions (id, title, lightweight progress summary) for the card list; `missionId` present → existing single-mission detail behavior (milestones, `target_day` comparisons), now keyed off `mission.day0Date` (that specific mission's, from `getMissionById`-style lookup, not `getActiveMission`).
- [ ] **Step 2:** Add a `getMissionById(userId, missionId)` repository function to `packages/db/src/repository.ts` in this task (not previously added — Task 4 only added `getActiveMissions`/`createMission`/`createTask`/`updateMissionStatus`).
- [ ] **Step 3:** Update the frontend "Путь" screen: list of active-goal cards (title + progress) routing to the existing detail view with `missionId` in the route/query instead of assuming a singleton.
- [ ] **Step 4:** Add "Завершить"/"Отложить" action buttons on each card, calling the new `PATCH /api/missions/[id]` from Task 17.
- [ ] **Step 5: Run web tests, commit**

```bash
git add apps/web/src/app/api/path/route.ts apps/web/src/app/path/
git commit -m "web: Путь screen lists active goals, detail view keyed by missionId"
```

---

### Task 16: `apps/web/src/app/api/content/[id]/route.ts` — publish attribution

**Files:**
- Modify: `apps/web/src/app/api/content/[id]/route.ts:99`

- [ ] **Step 1:** Same resolution as Task 11 — prefer reading the draft's own `missionId` if available; otherwise require an explicit `missionId` in the publish request body when more than one mission is active, reject with a clear error code if omitted and ambiguous.
- [ ] **Step 2: Run web tests, commit**

```bash
git add apps/web/src/app/api/content/[id]/route.ts
git commit -m "web: publish endpoint requires explicit missionId when multiple goals are active"
```

---

### Task 17: `PATCH /api/missions/[id]` — new route

**Files:**
- Create: `apps/web/src/app/api/missions/[id]/route.ts`

`updateMissionStatus` and `VALID_TRANSITIONS` already exist from Task 4 Step 6 and `getMissionById` from Task 15 Step 2 — this task only adds the route handler, no repository changes.

- [ ] **Step 1: Route handler**

```ts
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const body = await request.json();
  const status = body?.status;
  if (!["completed", "abandoned", "paused", "active"].includes(status)) {
    return NextResponse.json({ code: "INVALID_STATUS" }, { status: 400 });
  }

  const current = await getMissionById(session.userId, params.id);
  if (!current) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const allowed = VALID_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(status)) {
    return NextResponse.json({ code: "INVALID_TRANSITION" }, { status: 409 });
  }

  const updated = await updateMissionStatus(session.userId, params.id, status);
  return NextResponse.json({ mission: updated });
}
```

(Reactivating a `paused` mission to `active` goes through the same cap trigger from Task 1 — a user at cap with a paused goal will get a DB error on reactivation attempt; surface that as a 409 with a clear message, not a 500.)

- [ ] **Step 2: Write a route test** (find the pattern used by existing route tests, e.g. `apps/web/test/e2e.test.ts` or route-level unit tests) covering: valid transition succeeds, invalid transition (e.g. `completed` → `active`) rejects, reactivating at cap rejects with a clear error, cross-user access (missionId belonging to another user) 404s.
- [ ] **Step 3: Run tests, commit**

```bash
git add apps/web/src/app/api/missions/[id]/route.ts
git commit -m "web: PATCH /api/missions/[id] for status transitions (Завершить/Отложить)"
```

---

### Task 18: `apps/bot/test/full-flow.test.ts` — end-to-end coverage

**Files:**
- Modify: `apps/bot/test/full-flow.test.ts`

- [ ] **Step 1:** Add a scenario: complete onboarding for goal #1, add goal #2 via the new entry point (Task 8 Step 6), confirm `/today` produces two grouped tasks (one per goal).
- [ ] **Step 2:** Add a cap scenario: add goals up to `MAX_ACTIVE_MISSIONS`, attempt a 6th, confirm the refusal message + inline "Завершить"/"Отложить" menu appears (not a dead end), pick "Отложить" on one, confirm the slot frees and a 6th goal can now be added.
- [ ] **Step 3:** Add a report scenario: `/today` with two active goals, send a report against the *second* goal's task (not the first/"primary" one), confirm it's accepted and recorded against the correct `mission_id`.
- [ ] **Step 4: Run full-flow tests**

Run: `pnpm --filter @nevidimka/bot test full-flow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/test/full-flow.test.ts
git commit -m "test: full-flow coverage for multi-goal onboarding, cap, and per-goal reporting"
```

---

### Task 19: `apps/web/test/e2e.test.ts` — Mini App coverage

**Files:**
- Modify: `apps/web/test/e2e.test.ts`

- [ ] **Step 1:** Add: goal list → tap a card → detail view navigation (assert correct `missionId` reaches the detail route).
- [ ] **Step 2:** Add: "Отложить" action from a card, confirm the status change persists in the DB (query via a test helper, not just asserting the UI updated) and the goal drops out of the active-goal list.
- [ ] **Step 3: Run e2e tests, commit**

```bash
git add apps/web/test/e2e.test.ts
git commit -m "test: e2e coverage for goal list navigation and Отложить persistence"
```

---

## Final verification

- [ ] Run full repo check suite: `pnpm typecheck && pnpm lint && pnpm test` (adjust to actual root scripts in `package.json`) — expect zero errors across all packages/apps.
- [ ] Grep for any remaining `getActiveMission(` (singular) call sites: `rg "getActiveMission\(" --type ts` — expect zero matches outside of the now-removed old export.
- [ ] Grep for any remaining reads of `user.day0Date` / `user.programLength` / `users.day0_date` / `users.program_length`: expect zero matches (columns dropped in Task 1).
- [ ] Grep for any remaining reads of `.mainTaskId` / `main_task_id`: `rg "mainTaskId|main_task_id" --type ts` — expect matches only inside `mapDailyPlan`'s type definition and the `daily_plans` migration/repository code that deliberately keeps the column unused (per Task 4 Step 4); any call site still gating logic on it is a straggler that must be fixed before this ships, since Tasks 7/9 only rewired the call sites known at plan-writing time.
- [ ] Update `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` per `CLAUDE.md`'s "update docs if behavior changed" rule: record the schema change (missions cap trigger, per-mission day0/programLength) and the multi-goal product decision.
- [ ] Update `docs/KNOWN_BUGS.md` if any of the "deferred" items above (mentor UI goal-selector, content-draft `mission_id` backfill) are left as explicit follow-ups rather than fully closed.
