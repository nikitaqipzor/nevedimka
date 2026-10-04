import type {
  AiLog,
  AiRole,
  AnalyticsSummary,
  ContentDraft,
  ContentDraftStatus,
  ContentVersion,
  ContentVersionStep,
  DailyCheckIn,
  DailyPlan,
  Evidence,
  EvidenceKind,
  FocusSession,
  Idea,
  MentorMessage,
  MentorMessageRole,
  Milestone,
  Mission,
  PrivacyFlag,
  ProgramLength,
  Publication,
  PublicationStatus,
  SkillProgress,
  Task,
  TaskStatus,
  User,
  VideoAsset,
  VideoAssetStatus,
  VideoCutPlan,
  VideoCutPlanSource,
  VideoCutRecord,
  VideoRender,
  VideoRenderKind,
} from "@nevidimka/shared-types";
import { join } from "node:path";
import { assertAccountDeletionCanProceed } from "./accountDeletion.js";
import { withSystemContext, withUserContext } from "./client.js";
import { deleteLocalStorageEntries, resolveLocalStorageRoots } from "./storageCleanup.js";

// --- row mappers -----------------------------------------------------------

function mapUser(r: any): User {
  return {
    id: r.id,
    telegramId: r.telegram_id,
    username: r.username ?? undefined,
    firstName: r.first_name ?? undefined,
    day0Date: r.day0_date,
    programLength: r.program_length as ProgramLength,
    timezone: r.timezone,
    reminderHourMorning: r.reminder_hour_morning ?? undefined,
    reminderHourEvening: r.reminder_hour_evening ?? undefined,
    channelId: r.channel_id ?? undefined,
    createdAt: r.created_at,
  };
}

function mapMission(r: any): Mission {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    description: r.description ?? undefined,
    directions: r.directions ?? [],
    commitmentText: r.commitment_text ?? "",
    status: r.status,
    createdAt: r.created_at,
  };
}

function mapMilestone(r: any): Milestone {
  return {
    id: r.id,
    missionId: r.mission_id,
    title: r.title,
    targetDay: r.target_day,
    status: r.status,
    createdAt: r.created_at,
  };
}

function mapDailyPlan(r: any): DailyPlan {
  const checkIn: DailyCheckIn | undefined =
    r.sleep_quality || r.energy || r.mood || r.stress || r.check_in_note
      ? {
          sleepQuality: r.sleep_quality ?? undefined,
          energy: r.energy ?? undefined,
          mood: r.mood ?? undefined,
          stress: r.stress ?? undefined,
          note: r.check_in_note ?? undefined,
        }
      : undefined;
  return {
    id: r.id,
    userId: r.user_id,
    date: r.date,
    dayNumber: r.day_number,
    checkIn,
    mainTaskId: r.main_task_id ?? undefined,
    additionalTaskIds: [], // filled separately via listTasksForPlan when needed
    aiSummary: r.ai_summary ?? undefined,
    eveningReviewNote: r.evening_review_note ?? undefined,
    createdAt: r.created_at,
  };
}

function mapTask(r: any): Task {
  return {
    id: r.id,
    userId: r.user_id,
    missionId: r.mission_id ?? undefined,
    dailyPlanId: r.daily_plan_id ?? undefined,
    title: r.title,
    isMainTask: r.is_main_task,
    status: r.status as TaskStatus,
    direction: r.direction ?? undefined,
    estimateMinutes: r.estimate_minutes ?? undefined,
    actualMinutes: r.actual_minutes ?? undefined,
    completionPercent: r.completion_percent ?? undefined,
    postponedCount: r.postponed_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFocusSession(r: any): FocusSession {
  return {
    id: r.id,
    userId: r.user_id,
    taskId: r.task_id ?? undefined,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
    durationSeconds: r.duration_seconds ?? undefined,
    wasInterrupted: r.was_interrupted,
  };
}

function mapEvidence(r: any): Evidence {
  return {
    id: r.id,
    userId: r.user_id,
    taskId: r.task_id ?? undefined,
    kind: r.kind as EvidenceKind,
    storagePath: r.storage_path,
    transcript: r.transcript ?? undefined,
    rawText: r.raw_text ?? undefined,
    createdAt: r.created_at,
  };
}

function mapIdea(r: any): Idea {
  return {
    id: r.id,
    userId: r.user_id,
    text: r.text,
    status: r.status,
    createdAt: r.created_at,
  };
}

// --- users -------------------------------------------------------------

export async function getOrCreateUser(params: {
  telegramId: string;
  username?: string;
  firstName?: string;
}): Promise<User> {
  return withSystemContext(async (client) => {
    // Atomic upsert: two concurrent calls for the same telegram_id (e.g. a
    // duplicated webhook delivery, or a double /start) can both miss on a
    // plain SELECT-then-INSERT and race to insert, so the INSERT relies on
    // the existing `users_telegram_id_key` unique constraint (telegram_id
    // unique, see migrations/001_init.sql) to resolve the race atomically
    // instead of throwing 23505 on the second caller. The DO UPDATE SET is a
    // no-op (re-sets telegram_id to the value that just caused the
    // conflict) purely so RETURNING always yields the existing row; no
    // other column is touched, so an existing user's data is never
    // overwritten by a later getOrCreateUser call.
    const inserted = await client.query(
      `insert into users (telegram_id, username, first_name, timezone, day0_date)
       values ($1, $2, $3, $4, (now() at time zone $4)::date)
       on conflict (telegram_id) do update set telegram_id = excluded.telegram_id
       returning *`,
      // Keep the initial timezone aligned with migrations/001_init.sql.
      // Database current_date uses the server zone, which can already be
      // yesterday for this user and incorrectly start the journey at Day 2.
      [params.telegramId, params.username ?? null, params.firstName ?? null, "Europe/Amsterdam"]
    );
    return mapUser(inserted.rows[0]);
  });
}

export async function getUserById(userId: string): Promise<User | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query("select * from users where id = $1", [userId]);
    return r.rowCount ? mapUser(r.rows[0]) : null;
  });
}

/**
 * Finds users whose *local* reminder hour (morning or evening) is the
 * current hour right now, evaluated per-user via their stored IANA
 * timezone. Intended to be called once per hour by a cron job — see
 * apps/bot/src/jobs/. Cross-user by nature, so it uses withSystemContext
 * rather than withUserContext (there is no single owning user for this
 * query); callers must not expose it to anything but trusted internal jobs.
 */
export async function listUsersForReminder(
  kind: "morning" | "evening"
): Promise<User[]> {
  const column = kind === "morning" ? "reminder_hour_morning" : "reminder_hour_evening";
  return withSystemContext(async (client) => {
    const r = await client.query(
      `select * from users
       where ${column} is not null
         and extract(hour from (now() at time zone timezone))::int = ${column}`
    );
    return r.rows.map(mapUser);
  });
}

export async function setProgramLength(
  userId: string,
  programLength: ProgramLength
): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query("update users set program_length = $2 where id = $1", [
      userId,
      programLength,
    ])
  );
}

export async function setTimezone(userId: string, timezone: string): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query("update users set timezone = $2 where id = $1", [userId, timezone])
  );
}

/**
 * Sets when the proactive morning/evening reminder jobs should message
 * this user (see apps/bot/src/jobs/). Pass null to disable that reminder.
 * Without ever calling this, a user's reminder_hour_* columns stay NULL
 * forever (no DB default — see migrations/001_init.sql), and
 * listUsersForReminder() never matches them: the cron jobs run every hour
 * as designed but silently have nobody to notify. This was found and
 * fixed after the fact — see AUDIT_REPORT.md.
 */
export async function setReminderHours(
  userId: string,
  morningHour: number | null,
  eveningHour: number | null
): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query(
      "update users set reminder_hour_morning = $2, reminder_hour_evening = $3 where id = $1",
      [userId, morningHour, eveningHour]
    )
  );
}

export async function setChannelId(userId: string, channelId: string | null): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query("update users set channel_id = $2 where id = $1", [userId, channelId])
  );
}

// --- missions ------------------------------------------------------------

export async function createMission(params: {
  userId: string;
  title: string;
  description?: string;
  directions: string[];
  commitmentText: string;
}): Promise<Mission> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into missions (user_id, title, description, directions, commitment_text, status)
       values ($1, $2, $3, $4, $5, 'active') returning *`,
      [
        params.userId,
        params.title,
        params.description ?? null,
        params.directions,
        params.commitmentText,
      ]
    );
    return mapMission(r.rows[0]);
  });
}

export async function createMilestone(params: {
  userId: string;
  missionId: string;
  title: string;
  targetDay: number;
}): Promise<Milestone> {
  return withUserContext(params.userId, async (client) => {
    // milestones has no user_id column of its own — ownership is transitive
    // through mission_id. The WHERE EXISTS guards against inserting a
    // milestone under a mission_id the caller doesn't actually own, as
    // defense-in-depth alongside RLS (see also listMilestones below).
    const r = await client.query(
      `insert into milestones (mission_id, title, target_day)
       select $1, $2, $3
       where exists (select 1 from missions where id = $1 and user_id = $4)
       returning *`,
      [params.missionId, params.title, params.targetDay, params.userId]
    );
    if (r.rowCount === 0) {
      throw new Error("createMilestone: mission not found or not owned by this user");
    }
    return mapMilestone(r.rows[0]);
  });
}

export async function getActiveMission(userId: string): Promise<Mission | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from missions where user_id = $1 and status = 'active' order by created_at desc limit 1",
      [userId]
    );
    return r.rowCount ? mapMission(r.rows[0]) : null;
  });
}

// --- daily plans -----------------------------------------------------------

export async function getOrCreateTodayPlan(
  userId: string,
  date: string,
  dayNumber: number
): Promise<DailyPlan> {
  return withUserContext(userId, async (client) => {
    // Atomic upsert: two concurrent calls for the same (user_id, date) (e.g.
    // a cron job and a manual /today request landing at the same moment)
    // can both miss on a plain SELECT-then-INSERT and race to insert, so the
    // INSERT relies on the existing `daily_plans_user_id_date_key` unique
    // constraint (unique (user_id, date), see migrations/001_init.sql) to
    // resolve the race atomically instead of throwing 23505 on the second
    // caller. The DO UPDATE SET is a no-op (re-sets date to the value that
    // just caused the conflict) purely so RETURNING always yields the
    // existing row; no other column is touched, so an already-existing
    // plan's check-in answers / ai_summary / evening review are never
    // clobbered by a later getOrCreateTodayPlan call for the same day.
    const inserted = await client.query(
      `insert into daily_plans (user_id, date, day_number)
       values ($1, $2, $3)
       on conflict (user_id, date) do update set date = excluded.date
       returning *`,
      [userId, date, dayNumber]
    );
    return mapDailyPlan(inserted.rows[0]);
  });
}

export async function saveCheckIn(
  userId: string,
  planId: string,
  checkIn: DailyCheckIn
): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query(
      `update daily_plans
       set sleep_quality = $2, energy = $3, mood = $4, stress = $5, check_in_note = $6
       where id = $1 and user_id = $7`,
      [
        planId,
        checkIn.sleepQuality ?? null,
        checkIn.energy ?? null,
        checkIn.mood ?? null,
        checkIn.stress ?? null,
        checkIn.note ?? null,
        userId,
      ]
    )
  );
}

export async function setPlanAiSummary(
  userId: string,
  planId: string,
  summary: string
): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query("update daily_plans set ai_summary = $2 where id = $1 and user_id = $3", [
      planId,
      summary,
      userId,
    ])
  );
}

export async function setEveningReview(
  userId: string,
  planId: string,
  note: string
): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query("update daily_plans set evening_review_note = $2 where id = $1 and user_id = $3", [
      planId,
      note,
      userId,
    ])
  );
}

export async function getRecentPlans(
  userId: string,
  limit = 7
): Promise<DailyPlan[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from daily_plans where user_id = $1 order by date desc limit $2",
      [userId, limit]
    );
    return r.rows.map(mapDailyPlan);
  });
}

// --- tasks -----------------------------------------------------------------

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
    const task = mapTask(r.rows[0]);
    if (task.isMainTask && params.dailyPlanId) {
      await client.query("update daily_plans set main_task_id = $2 where id = $1", [
        params.dailyPlanId,
        task.id,
      ]);
    }
    return task;
  });
}

export async function getTaskById(userId: string, taskId: string): Promise<Task | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query("select * from tasks where id = $1 and user_id = $2", [
      taskId,
      userId,
    ]);
    return r.rowCount ? mapTask(r.rows[0]) : null;
  });
}

export async function listTasksForPlan(
  userId: string,
  dailyPlanId: string
): Promise<Task[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from tasks where user_id = $1 and daily_plan_id = $2 order by is_main_task desc, created_at asc",
      [userId, dailyPlanId]
    );
    return r.rows.map(mapTask);
  });
}

export async function updateTaskStatus(
  userId: string,
  taskId: string,
  status: TaskStatus,
  completionPercent?: number
): Promise<Task> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update tasks
       set status = $2,
           completion_percent = coalesce($3, completion_percent),
           postponed_count = postponed_count + case when $2 = 'postponed' then 1 else 0 end,
           updated_at = now()
       where id = $1 and user_id = $4
       returning *`,
      [taskId, status, completionPercent ?? null, userId]
    );
    return mapTask(r.rows[0]);
  });
}

// --- focus sessions ----------------------------------------------------

export async function startFocusSession(
  userId: string,
  taskId?: string
): Promise<FocusSession> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `insert into focus_sessions (user_id, task_id) values ($1, $2) returning *`,
      [userId, taskId ?? null]
    );
    return mapFocusSession(r.rows[0]);
  });
}

export async function endFocusSession(
  userId: string,
  sessionId: string,
  wasInterrupted = false
): Promise<FocusSession> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update focus_sessions
       set ended_at = now(),
           duration_seconds = extract(epoch from (now() - started_at))::int,
           was_interrupted = $3
       where id = $1 and user_id = $2
       returning *`,
      [sessionId, userId, wasInterrupted]
    );
    return mapFocusSession(r.rows[0]);
  });
}

// --- evidences ---------------------------------------------------------

export async function addEvidence(params: {
  userId: string;
  taskId?: string;
  kind: EvidenceKind;
  storagePath?: string;
  transcript?: string;
  rawText?: string;
}): Promise<Evidence> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into evidences (user_id, task_id, kind, storage_path, transcript, raw_text)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [
        params.userId,
        params.taskId ?? null,
        params.kind,
        params.storagePath ?? null,
        params.transcript ?? null,
        params.rawText ?? null,
      ]
    );
    return mapEvidence(r.rows[0]);
  });
}

// --- ideas ---------------------------------------------------------------

export async function addIdea(userId: string, text: string): Promise<Idea> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "insert into ideas (user_id, text) values ($1, $2) returning *",
      [userId, text]
    );
    return mapIdea(r.rows[0]);
  });
}

export async function listInboxIdeas(userId: string): Promise<Idea[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from ideas where user_id = $1 and status = 'inbox' order by created_at desc",
      [userId]
    );
    return r.rows.map(mapIdea);
  });
}

// --- ai logs ---------------------------------------------------------------

export async function logAiCall(params: {
  userId: string;
  role: AiRole;
  input: unknown;
  output: unknown;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}): Promise<AiLog> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into ai_logs (user_id, role, input, output, tokens_in, tokens_out, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [
        params.userId,
        params.role,
        JSON.stringify(params.input),
        JSON.stringify(params.output),
        params.tokensIn ?? null,
        params.tokensOut ?? null,
        params.costUsd ?? null,
      ]
    );
    const row = r.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      input: row.input,
      output: row.output,
      tokensIn: row.tokens_in ?? undefined,
      tokensOut: row.tokens_out ?? undefined,
      costUsd: row.cost_usd ?? undefined,
      createdAt: row.created_at,
    };
  });
}

/**
 * Counts a user's AI calls (any role) in the last `windowMinutes` — the
 * basis for rate limiting (see packages/ai's assertAiRateLimit). Backed by
 * ai_logs rather than an in-memory counter, since apps/bot, apps/web, and
 * apps/worker are separate processes that would otherwise each keep their
 * own uncoordinated count.
 */
export async function countRecentAiCalls(userId: string, windowMinutes: number): Promise<number> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `select count(*)::int as count from ai_logs
       where user_id = $1 and created_at >= now() - ($2 || ' minutes')::interval`,
      [userId, windowMinutes]
    );
    return r.rows[0].count as number;
  });
}

// --- Release 2: milestones, skills, analytics, journal, mentor chat -------

export async function listMilestones(userId: string, missionId: string): Promise<Milestone[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `select m.* from milestones m
       join missions mi on mi.id = m.mission_id
       where m.mission_id = $1 and mi.user_id = $2
       order by m.target_day asc`,
      [missionId, userId]
    );
    return r.rows.map(mapMilestone);
  });
}

/**
 * Updates the editable fields of a user's mission. Any field left undefined
 * is untouched, so a caller can patch just the commitment text without
 * resending the title.
 *
 * Scoped by user_id in the WHERE clause as well as by RLS — the Mini App's
 * PATCH takes the mission id from the session's active mission, never from
 * the request body, but the redundant check keeps this safe if a future
 * caller passes an id in.
 */
export async function updateMission(
  userId: string,
  missionId: string,
  fields: {
    title?: string;
    description?: string | null;
    directions?: string[];
    commitmentText?: string;
  }
): Promise<Mission | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update missions set
         title = coalesce($3, title),
         description = case when $4::boolean then $5 else description end,
         directions = coalesce($6::text[], directions),
         commitment_text = coalesce($7, commitment_text)
       where id = $1 and user_id = $2
       returning *`,
      [
        missionId,
        userId,
        fields.title ?? null,
        fields.description !== undefined,
        fields.description ?? null,
        fields.directions ?? null,
        fields.commitmentText ?? null,
      ]
    );
    return r.rowCount ? mapMission(r.rows[0]) : null;
  });
}

/**
 * Replaces a mission's milestones wholesale, in one transaction.
 *
 * Replace rather than patch: the Path screen edits the milestone list as a
 * single unit (add, remove, reorder by target day), so diffing individual
 * rows client-side would be more code and more ways to desync. Doing it in
 * one withUserContext call means it is one transaction — a failure part-way
 * leaves the previous list intact rather than a half-replaced one.
 */
export async function replaceMilestones(
  userId: string,
  missionId: string,
  milestones: { title: string; targetDay: number }[]
): Promise<Milestone[]> {
  return withUserContext(userId, async (client) => {
    // Ownership check first: the delete below is scoped by mission_id, which
    // RLS already restricts to this user's missions, but failing loudly on a
    // foreign id is better than silently deleting nothing and inserting.
    const owns = await client.query(
      "select 1 from missions where id = $1 and user_id = $2",
      [missionId, userId]
    );
    if (!owns.rowCount) return [];

    await client.query("delete from milestones where mission_id = $1", [missionId]);

    for (const m of milestones) {
      await client.query(
        "insert into milestones (mission_id, title, target_day) values ($1, $2, $3)",
        [missionId, m.title, m.targetDay]
      );
    }

    const r = await client.query(
      "select * from milestones where mission_id = $1 order by target_day asc",
      [missionId]
    );
    return r.rows.map(mapMilestone);
  });
}

/**
 * Sets the user's Day 0 — the date the program counts from. Needed because
 * the Mini App's onboarding lets someone start their path today (the
 * default) or backdate it to when they actually began.
 */
export async function setDay0Date(userId: string, day0Date: string): Promise<void> {
  await withUserContext(userId, (client) =>
    client.query("update users set day0_date = $2 where id = $1", [userId, day0Date])
  );
}

export async function getSkillsProgress(userId: string): Promise<SkillProgress[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `select
         direction,
         count(*)::int as total,
         count(*) filter (where status = 'done')::int as done
       from tasks
       where user_id = $1 and direction is not null
       group by direction
       order by direction asc`,
      [userId]
    );
    return r.rows.map((row) => ({
      direction: row.direction as string,
      totalTasks: row.total as number,
      doneTasks: row.done as number,
      completionPercent: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0,
    }));
  });
}

export async function getAnalyticsSummary(userId: string, days: number): Promise<AnalyticsSummary> {
  return withUserContext(userId, async (client) => {
    const taskStats = await client.query(
      `select
         count(*)::int as planned,
         count(*) filter (where status = 'done')::int as done,
         count(*) filter (where status = 'postponed')::int as postponed
       from tasks
       where user_id = $1 and created_at >= now() - ($2 || ' days')::interval`,
      [userId, days]
    );
    const focusStats = await client.query(
      `select
         coalesce(sum(duration_seconds), 0)::int as total_seconds,
         count(*)::int as session_count
       from focus_sessions
       where user_id = $1 and started_at >= now() - ($2 || ' days')::interval
         and ended_at is not null`,
      [userId, days]
    );
    const checkInStats = await client.query(
      `select
         avg(sleep_quality)::float as avg_sleep,
         avg(energy)::float as avg_energy,
         avg(mood)::float as avg_mood,
         avg(stress)::float as avg_stress
       from daily_plans
       where user_id = $1 and date >= (current_date - $2::int)`,
      [userId, days]
    );

    const t = taskStats.rows[0];
    const f = focusStats.rows[0];
    const c = checkInStats.rows[0];
    const planned = t.planned as number;
    const done = t.done as number;

    return {
      periodDays: days,
      tasksPlanned: planned,
      tasksDone: done,
      completionRate: planned > 0 ? Math.round((done / planned) * 100) : 0,
      postponedCount: t.postponed as number,
      focusMinutesTotal: Math.round((f.total_seconds as number) / 60),
      focusSessionCount: f.session_count as number,
      averageSleep: c.avg_sleep != null ? Number(c.avg_sleep.toFixed(1)) : undefined,
      averageEnergy: c.avg_energy != null ? Number(c.avg_energy.toFixed(1)) : undefined,
      averageMood: c.avg_mood != null ? Number(c.avg_mood.toFixed(1)) : undefined,
      averageStress: c.avg_stress != null ? Number(c.avg_stress.toFixed(1)) : undefined,
    };
  });
}

export async function listEvidencesForUser(userId: string, limit = 30): Promise<Evidence[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from evidences where user_id = $1 order by created_at desc limit $2",
      [userId, limit]
    );
    return r.rows.map(mapEvidence);
  });
}

export async function addMentorMessage(params: {
  userId: string;
  role: MentorMessageRole;
  content: string;
}): Promise<MentorMessage> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into mentor_messages (user_id, role, content) values ($1, $2, $3) returning *`,
      [params.userId, params.role, params.content]
    );
    const row = r.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    };
  });
}

export async function listMentorMessages(userId: string, limit = 50): Promise<MentorMessage[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `select * from (
         select * from mentor_messages where user_id = $1 order by created_at desc limit $2
       ) recent order by created_at asc`,
      [userId, limit]
    );
    return r.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role as MentorMessageRole,
      content: row.content,
      createdAt: row.created_at,
    }));
  });
}

// --- Release 3: content drafts, versions, publications ---------------------

function mapContentDraft(r: any): ContentDraft {
  return {
    id: r.id,
    userId: r.user_id,
    sourceEvidenceId: r.source_evidence_id ?? undefined,
    sourceText: r.source_text,
    status: r.status as ContentDraftStatus,
    chosenVersionId: r.chosen_version_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapContentVersion(r: any): ContentVersion {
  return {
    id: r.id,
    draftId: r.draft_id,
    userId: r.user_id,
    step: r.step as ContentVersionStep,
    text: r.text,
    privacyFlags: r.privacy_flags ?? undefined,
    createdAt: r.created_at,
  };
}

function mapPublication(r: any): Publication {
  return {
    id: r.id,
    userId: r.user_id,
    draftId: r.draft_id ?? undefined,
    contentVersionId: r.content_version_id ?? undefined,
    videoAssetId: r.video_asset_id ?? undefined,
    videoRenderId: r.video_render_id ?? undefined,
    channelId: r.channel_id,
    telegramMessageId: r.telegram_message_id != null ? Number(r.telegram_message_id) : undefined,
    publishedHtml: r.published_html,
    editedHtml: r.edited_html ?? undefined,
    editedAt: r.edited_at ?? undefined,
    status: r.status as PublicationStatus,
    errorMessage: r.error_message ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createContentDraft(params: {
  userId: string;
  sourceText: string;
  sourceEvidenceId?: string;
}): Promise<ContentDraft> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into content_drafts (user_id, source_text, source_evidence_id)
       values ($1, $2, $3) returning *`,
      [params.userId, params.sourceText, params.sourceEvidenceId ?? null]
    );
    return mapContentDraft(r.rows[0]);
  });
}

export async function getContentDraft(userId: string, draftId: string): Promise<ContentDraft | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from content_drafts where id = $1 and user_id = $2",
      [draftId, userId]
    );
    return r.rowCount ? mapContentDraft(r.rows[0]) : null;
  });
}

export async function listContentDrafts(userId: string, limit = 30): Promise<ContentDraft[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from content_drafts where user_id = $1 order by created_at desc limit $2",
      [userId, limit]
    );
    return r.rows.map(mapContentDraft);
  });
}

export async function updateDraftStatus(
  userId: string,
  draftId: string,
  status: ContentDraftStatus
): Promise<ContentDraft> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "update content_drafts set status = $2, updated_at = now() where id = $1 and user_id = $3 returning *",
      [draftId, status, userId]
    );
    return mapContentDraft(r.rows[0]);
  });
}

export async function setChosenVersion(
  userId: string,
  draftId: string,
  versionId: string
): Promise<ContentDraft> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "update content_drafts set chosen_version_id = $2, updated_at = now() where id = $1 and user_id = $3 returning *",
      [draftId, versionId, userId]
    );
    return mapContentDraft(r.rows[0]);
  });
}

export async function addContentVersion(params: {
  userId: string;
  draftId: string;
  step: ContentVersionStep;
  text: string;
  privacyFlags?: PrivacyFlag[];
}): Promise<ContentVersion> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into content_versions (draft_id, user_id, step, text, privacy_flags)
       values ($1, $2, $3, $4, $5) returning *`,
      [
        params.draftId,
        params.userId,
        params.step,
        params.text,
        params.privacyFlags ? JSON.stringify(params.privacyFlags) : null,
      ]
    );
    return mapContentVersion(r.rows[0]);
  });
}

export async function listContentVersions(userId: string, draftId: string): Promise<ContentVersion[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from content_versions where draft_id = $1 and user_id = $2 order by created_at asc",
      [draftId, userId]
    );
    return r.rows.map(mapContentVersion);
  });
}

export async function getContentVersion(
  userId: string,
  versionId: string
): Promise<ContentVersion | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from content_versions where id = $1 and user_id = $2",
      [versionId, userId]
    );
    return r.rowCount ? mapContentVersion(r.rows[0]) : null;
  });
}

/**
 * The one allowed mutation on content_versions: attaching the
 * privacy_guard result computed after the row was inserted. This does not
 * touch the `text` column, so the append-only "exact snapshot" guarantee
 * for what the user saw still holds — only the risk annotations are added.
 */
export async function setContentVersionPrivacyFlags(
  userId: string,
  versionId: string,
  flags: PrivacyFlag[]
): Promise<ContentVersion> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "update content_versions set privacy_flags = $2 where id = $1 and user_id = $3 returning *",
      [versionId, JSON.stringify(flags), userId]
    );
    return mapContentVersion(r.rows[0]);
  });
}

/**
 * Records a text-post publish attempt. The unique index on
 * publications(draft_id) WHERE status = 'published' (see migration
 * 004_release3.sql) means a second call for the same draft after a
 * successful publish fails at the database level, not just in application
 * logic — belt-and-suspenders idempotency for the "no duplicate posts" rule.
 */
export async function createTextPublication(params: {
  userId: string;
  draftId: string;
  contentVersionId: string;
  channelId: string;
  publishedHtml: string;
}): Promise<Publication> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into publications (user_id, draft_id, content_version_id, channel_id, published_html, status)
       values ($1, $2, $3, $4, $5, 'pending') returning *`,
      [params.userId, params.draftId, params.contentVersionId, params.channelId, params.publishedHtml]
    );
    return mapPublication(r.rows[0]);
  });
}

/**
 * Records a video-post publish attempt. Same idempotency guarantee as
 * createTextPublication, via uq_publications_video_published (migration
 * 005_release4.sql).
 */
export async function createVideoPublication(params: {
  userId: string;
  videoAssetId: string;
  videoRenderId: string;
  channelId: string;
  publishedHtml: string;
}): Promise<Publication> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into publications (user_id, video_asset_id, video_render_id, channel_id, published_html, status)
       values ($1, $2, $3, $4, $5, 'pending') returning *`,
      [params.userId, params.videoAssetId, params.videoRenderId, params.channelId, params.publishedHtml]
    );
    return mapPublication(r.rows[0]);
  });
}

export async function markPublicationSent(
  userId: string,
  publicationId: string,
  telegramMessageId: number
): Promise<Publication> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update publications
       set status = 'published', telegram_message_id = $2, updated_at = now()
       where id = $1 and user_id = $3 returning *`,
      [publicationId, telegramMessageId, userId]
    );
    return mapPublication(r.rows[0]);
  });
}

export async function markPublicationFailed(
  userId: string,
  publicationId: string,
  errorMessage: string
): Promise<Publication> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update publications
       set status = 'failed', error_message = $2, updated_at = now()
       where id = $1 and user_id = $3 returning *`,
      [publicationId, errorMessage, userId]
    );
    return mapPublication(r.rows[0]);
  });
}

export async function getPublicationByDraftId(
  userId: string,
  draftId: string
): Promise<Publication | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from publications where draft_id = $1 and user_id = $2 order by created_at desc limit 1",
      [draftId, userId]
    );
    return r.rowCount ? mapPublication(r.rows[0]) : null;
  });
}

export async function listPublications(userId: string, limit = 30): Promise<Publication[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from publications where user_id = $1 order by created_at desc limit $2",
      [userId, limit]
    );
    return r.rows.map(mapPublication);
  });
}

export async function getPublication(userId: string, publicationId: string): Promise<Publication | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query("select * from publications where id = $1 and user_id = $2", [
      publicationId,
      userId,
    ]);
    return r.rowCount ? mapPublication(r.rows[0]) : null;
  });
}

/**
 * Records that an already-published post was edited. Deliberately does
 * NOT touch published_html — that stays the immutable record of what was
 * originally sent (same guarantee as content_versions), with the current
 * text tracked separately in edited_html/edited_at so both are always
 * visible.
 */
export async function markPublicationEdited(
  userId: string,
  publicationId: string,
  newHtml: string
): Promise<Publication> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update publications
       set status = 'edited', edited_html = $2, edited_at = now(), updated_at = now()
       where id = $1 and user_id = $3 returning *`,
      [publicationId, newHtml, userId]
    );
    return mapPublication(r.rows[0]);
  });
}

export async function markPublicationDeleted(userId: string, publicationId: string): Promise<Publication> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update publications set status = 'deleted', updated_at = now()
       where id = $1 and user_id = $2 returning *`,
      [publicationId, userId]
    );
    return mapPublication(r.rows[0]);
  });
}

export async function getPublicationByVideoAssetId(
  userId: string,
  videoAssetId: string
): Promise<Publication | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from publications where video_asset_id = $1 and user_id = $2 order by created_at desc limit 1",
      [videoAssetId, userId]
    );
    return r.rowCount ? mapPublication(r.rows[0]) : null;
  });
}

// --- Release 4: video pipeline ---------------------------------------------

/**
 * video_transcripts row shape. Defined locally (not in @nevidimka/shared-types
 * alongside VideoAsset/VideoCutPlan/VideoRender) because this fix's scope is
 * limited to packages/db, packages/video, and apps/worker.
 */
export interface VideoTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VideoTranscript {
  id: string;
  videoAssetId: string;
  userId: string;
  fullText: string;
  segments: VideoTranscriptSegment[];
  createdAt: string;
}

function mapVideoTranscript(r: any): VideoTranscript {
  return {
    id: r.id,
    videoAssetId: r.video_asset_id,
    userId: r.user_id,
    fullText: r.full_text,
    segments: r.segments as VideoTranscriptSegment[],
    createdAt: r.created_at,
  };
}

function mapVideoAsset(r: any): VideoAsset {
  return {
    id: r.id,
    userId: r.user_id,
    sourceEvidenceId: r.source_evidence_id ?? undefined,
    originalStoragePath: r.original_storage_path,
    durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    status: r.status as VideoAssetStatus,
    errorMessage: r.error_message ?? undefined,
    attempts: r.attempts ?? 0,
    nextRetryAt: r.next_retry_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapVideoCutPlan(r: any): VideoCutPlan {
  return {
    id: r.id,
    videoAssetId: r.video_asset_id,
    userId: r.user_id,
    cuts: r.cuts as VideoCutRecord[],
    source: r.source as VideoCutPlanSource,
    createdAt: r.created_at,
  };
}

function mapVideoRender(r: any): VideoRender {
  return {
    id: r.id,
    videoAssetId: r.video_asset_id,
    userId: r.user_id,
    kind: r.kind as VideoRenderKind,
    storagePath: r.storage_path,
    coverPath: r.cover_path ?? undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : undefined,
    createdAt: r.created_at,
  };
}

export async function createVideoAsset(params: {
  userId: string;
  originalStoragePath: string;
  sourceEvidenceId?: string;
}): Promise<VideoAsset> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into video_assets (user_id, original_storage_path, source_evidence_id)
       values ($1, $2, $3) returning *`,
      [params.userId, params.originalStoragePath, params.sourceEvidenceId ?? null]
    );
    return mapVideoAsset(r.rows[0]);
  });
}

/**
 * Atomically claims pending video jobs for this worker: moves them out of
 * the queued status ('uploaded' -> 'processing', 'confirmed' -> 'rendering')
 * and increments their attempt counter, all in one statement.
 *
 * Why claiming and not a plain SELECT: this used to be
 * `select ... where status = $1`, with the status transition happening later
 * inside processUploadedAsset. Between those two steps the row still looked
 * queued, so two worker processes (or one worker overlapping its own slow
 * tick) could both read the same asset and both run the full ffmpeg pipeline
 * and — for 'confirmed' — both publish. FOR UPDATE SKIP LOCKED plus the
 * status change inside the same statement closes that window: a second
 * claimer skips rows already locked by the first, and once committed the row
 * no longer matches the queued predicate at all.
 *
 * `next_retry_at` implements the backoff half of PROJECT_SPEC.md section
 * 14: recoverStaleVideoJobs sets it when requeueing a job that died, and a
 * job is not claimable until it passes. NULL means claimable now.
 *
 * `attempts` is incremented here — at claim time — rather than on failure,
 * because the failures this must bound are exactly the ones that never
 * reach a failure handler (the worker process being killed mid-job).
 *
 * Same withSystemContext rationale as listUsersForReminder: this has no
 * single owning user, so it must bypass per-user RLS deliberately, and
 * should only ever be called by the trusted worker process.
 */
export async function claimVideoAssetsForProcessing(
  status: "uploaded" | "confirmed",
  limit = 5
): Promise<VideoAsset[]> {
  const claimedStatus = status === "uploaded" ? "processing" : "rendering";

  return withSystemContext(async (client) => {
    const r = await client.query(
      // $3 is cast explicitly: Postgres cannot infer a parameter's type in
       // LIMIT position, and an uncast placeholder there fails with
       // "could not determine data type of parameter $3".
       `with claimed as (
         select id from video_assets
         where status = $1
           and (next_retry_at is null or next_retry_at <= now())
         order by created_at asc
         limit $3::int
         for update skip locked
       )
       update video_assets a
       set status = $2,
           attempts = a.attempts + 1,
           updated_at = now()
       from claimed
       where a.id = claimed.id
       returning a.*`,
      [status, claimedStatus, limit]
    );
    return r.rows.map(mapVideoAsset);
  });
}

/**
 * Requeues video jobs stuck in 'processing' or 'rendering' for longer than
 * `staleMinutes`. This should only ever fire after the worker process
 * itself crashed or was force-restarted mid-job — both ffmpeg (see
 * packages/video's runCommand timeout) and the Telegram HTTP calls (see
 * packages/telegram's AbortSignal.timeout) now time out and transition to
 * 'failed' on their own otherwise, so a job sitting in an in-progress
 * status past this threshold has no other explanation. 'processing' goes
 * back to 'uploaded' (full pipeline restarts from the original upload);
 * 'rendering' goes back to 'confirmed' (final render is retried from the
 * already-processed master). Call this once at worker startup and safe to
 * call again on every poll tick — it's a no-op when nothing is stale.
 */
export async function recoverStaleVideoJobs(
  staleMinutes = 15,
  maxAttempts = 3
): Promise<{ requeued: number; deadLettered: number }> {
  return withSystemContext(async (client) => {
    // Both casts are explicit on purpose. $1::text: Postgres cannot infer a
    // parameter's type from `$1 || ' minutes'` alone. power(...)::int: power()
    // returns double precision, and `double precision * interval` is not a
    // defined operator — only `int * interval` and `numeric * interval` are.
    const stale = `now() - ($1::text || ' minutes')::interval`;

    // Jobs that still have attempts left go back to their queued status,
    // with an exponential backoff (2^attempts minutes, capped at an hour)
    // so a job that keeps killing the worker stops hot-looping.
    const requeued = await client.query(
      `update video_assets
       set status = case status
             when 'processing' then 'uploaded'
             when 'rendering' then 'confirmed'
           end,
           error_message = 'recovered after worker restart — retried automatically',
           next_retry_at = now() + least(
             power(2, attempts)::int * interval '1 minute',
             interval '1 hour'
           ),
           updated_at = now()
       where status in ('processing', 'rendering')
         and updated_at < ${stale}
         and attempts < $2
       returning id`,
      [staleMinutes, maxAttempts]
    );

    // Dead-letter: attempts exhausted. 'failed' is terminal — nothing
    // requeues out of it — and is already surfaced to the user, so the job
    // becomes visible instead of looping forever. See migration 011 for why
    // this reuses 'failed' rather than adding a status.
    const deadLettered = await client.query(
      `update video_assets
       set status = 'failed',
           error_message = 'обработка не удалась после ' || attempts
             || ' попыток — задача снята с очереди',
           updated_at = now()
       where status in ('processing', 'rendering')
         and updated_at < ${stale}
         and attempts >= $2
       returning id`,
      [staleMinutes, maxAttempts]
    );

    return {
      requeued: requeued.rowCount ?? 0,
      deadLettered: deadLettered.rowCount ?? 0,
    };
  });
}

export async function getVideoAsset(userId: string, videoAssetId: string): Promise<VideoAsset | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from video_assets where id = $1 and user_id = $2",
      [videoAssetId, userId]
    );
    return r.rowCount ? mapVideoAsset(r.rows[0]) : null;
  });
}

export async function listVideoAssets(userId: string, limit = 30): Promise<VideoAsset[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from video_assets where user_id = $1 order by created_at desc limit $2",
      [userId, limit]
    );
    return r.rows.map(mapVideoAsset);
  });
}

export async function updateVideoAssetStatus(
  userId: string,
  videoAssetId: string,
  status: VideoAssetStatus,
  errorMessage?: string
): Promise<VideoAsset> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update video_assets
       set status = $2,
           error_message = $3,
           -- Clear any pending backoff: a job that reaches a real terminal
           -- or waiting state ('preview_ready', 'published', 'failed',
           -- 'cancelled') is no longer mid-retry, and a stale next_retry_at
           -- would otherwise delay the NEXT claim of this asset — e.g. after
           -- the user confirms a preview that had been retried once.
           next_retry_at = null,
           updated_at = now()
       where id = $1 and user_id = $4 returning *`,
      [videoAssetId, status, errorMessage ?? null, userId]
    );
    return mapVideoAsset(r.rows[0]);
  });
}

export async function setVideoAssetProbe(
  userId: string,
  videoAssetId: string,
  probe: { durationSeconds: number; width: number; height: number }
): Promise<VideoAsset> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `update video_assets
       set duration_seconds = $2, width = $3, height = $4, updated_at = now()
       where id = $1 and user_id = $5 returning *`,
      [videoAssetId, probe.durationSeconds, probe.width, probe.height, userId]
    );
    return mapVideoAsset(r.rows[0]);
  });
}

export async function createVideoCutPlan(params: {
  userId: string;
  videoAssetId: string;
  cuts: VideoCutRecord[];
  source: VideoCutPlanSource;
}): Promise<VideoCutPlan> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into video_cut_plans (video_asset_id, user_id, cuts, source)
       values ($1, $2, $3, $4) returning *`,
      [params.videoAssetId, params.userId, JSON.stringify(params.cuts), params.source]
    );
    return mapVideoCutPlan(r.rows[0]);
  });
}

export async function getLatestVideoCutPlan(
  userId: string,
  videoAssetId: string
): Promise<VideoCutPlan | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `select * from video_cut_plans where video_asset_id = $1 and user_id = $2
       order by created_at desc limit 1`,
      [videoAssetId, userId]
    );
    return r.rowCount ? mapVideoCutPlan(r.rows[0]) : null;
  });
}

export async function createVideoRender(params: {
  userId: string;
  videoAssetId: string;
  kind: VideoRenderKind;
  storagePath: string;
  coverPath?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}): Promise<VideoRender> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into video_renders
         (video_asset_id, user_id, kind, storage_path, cover_path, width, height, duration_seconds)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        params.videoAssetId,
        params.userId,
        params.kind,
        params.storagePath,
        params.coverPath ?? null,
        params.width ?? null,
        params.height ?? null,
        params.durationSeconds ?? null,
      ]
    );
    return mapVideoRender(r.rows[0]);
  });
}

export async function getVideoRender(userId: string, renderId: string): Promise<VideoRender | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from video_renders where id = $1 and user_id = $2",
      [renderId, userId]
    );
    return r.rowCount ? mapVideoRender(r.rows[0]) : null;
  });
}

export async function getLatestVideoRender(
  userId: string,
  videoAssetId: string,
  kind: VideoRenderKind
): Promise<VideoRender | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      `select * from video_renders where video_asset_id = $1 and user_id = $2 and kind = $3
       order by created_at desc limit 1`,
      [videoAssetId, userId, kind]
    );
    return r.rowCount ? mapVideoRender(r.rows[0]) : null;
  });
}

/**
 * Persists a successful ASR transcription (see packages/video/src/asr.ts's
 * transcribeVideoAudio) so a retry of the same asset (e.g. via
 * recoverStaleVideoJobs) doesn't have to re-pay for transcription from
 * scratch. Caller (apps/worker/src/jobs.ts) treats this as best-effort —
 * a failure here should not abort the pipeline, since the transcript's
 * primary use (subtitles) already happened in-memory before this is called.
 */
export async function createVideoTranscript(params: {
  userId: string;
  videoAssetId: string;
  fullText: string;
  segments: VideoTranscriptSegment[];
}): Promise<VideoTranscript> {
  return withUserContext(params.userId, async (client) => {
    const r = await client.query(
      `insert into video_transcripts (video_asset_id, user_id, full_text, segments)
       values ($1, $2, $3, $4) returning *`,
      [params.videoAssetId, params.userId, params.fullText, JSON.stringify(params.segments)]
    );
    return mapVideoTranscript(r.rows[0]);
  });
}

// --- data export & account deletion (PROJECT_SPEC.md section 15) ---------

/**
 * Tables keyed by user_id — every table with user-owned rows except
 * `users` itself (keyed by `id`) and `milestones` (ownership is
 * transitive through mission_id, no user_id column of its own; included
 * separately below via a join).
 */
const EXPORTABLE_USER_ID_TABLES = [
  "missions",
  "daily_plans",
  "tasks",
  "focus_sessions",
  "evidences",
  "ideas",
  "ai_logs",
  "mentor_messages",
  "content_drafts",
  "content_versions",
  "publications",
  "video_assets",
  "video_transcripts",
  "video_cut_plans",
  "video_renders",
  "privacy_flags",
] as const;

/**
 * Collects every row this user owns, across every table, into one JSON-
 * serializable object — the "export my data" half of section 15's privacy
 * requirement. Runs under withUserContext, so RLS scopes every query to
 * this user regardless of which table is being read; the explicit
 * `user_id = $1` filters below are defense-in-depth on top of that, same
 * pattern used everywhere else in this file (see AUDIT_REPORT.md on why
 * that pattern matters).
 */
export async function exportUserData(userId: string): Promise<Record<string, unknown>> {
  return withUserContext(userId, async (client) => {
    const result: Record<string, unknown> = {};

    const userRow = await client.query("select * from users where id = $1", [userId]);
    result.users = userRow.rows;

    const milestonesRow = await client.query(
      `select m.* from milestones m
       join missions mi on mi.id = m.mission_id
       where mi.user_id = $1`,
      [userId]
    );
    result.milestones = milestonesRow.rows;

    for (const table of EXPORTABLE_USER_ID_TABLES) {
      const r = await client.query(`select * from ${table} where user_id = $1`, [userId]);
      result[table] = r.rows;
    }

    return result;
  });
}

/**
 * Deletes files referenced by the user's rows before deleting the user's
 * own row, which cascades through every table this user owns. All paths are
 * validated before the first unlink, and the rows are locked until the DB
 * transaction commits so a worker cannot mutate them during cleanup.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  await withUserContext(userId, async (client) => {
    // A transaction uses one pg client; issue queries sequentially.
    const evidences = await client.query(
      "select storage_path from evidences where user_id = $1 and storage_path is not null for update",
      [userId]
    );
    const assets = await client.query(
      "select id, original_storage_path, status from video_assets where user_id = $1 for update",
      [userId]
    );
    const renders = await client.query(
      "select storage_path, cover_path from video_renders where user_id = $1 for update",
      [userId]
    );

    assertAccountDeletionCanProceed(
      assets.rows.map((row) => row.status as VideoAssetStatus)
    );

    const storagePaths = [
      ...evidences.rows.map((row) => row.storage_path as string),
      ...assets.rows.map((row) => row.original_storage_path as string),
      ...renders.rows.flatMap((row) =>
        [row.storage_path, row.cover_path].filter((path): path is string => typeof path === "string")
      ),
    ];

    const storageRoots = resolveLocalStorageRoots();
    await deleteLocalStorageEntries(
      {
        files: storagePaths,
        directories: assets.rows.map((row) => join(storageRoots.video, row.id as string)),
      },
      storageRoots
    );
    await client.query("delete from users where id = $1", [userId]);
  });
}

