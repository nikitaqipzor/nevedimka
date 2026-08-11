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
  MissionStatus,
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
import { withSystemContext, withUserContext } from "./client.js";

// --- row mappers -----------------------------------------------------------

function mapUser(r: any): User {
  return {
    id: r.id,
    telegramId: r.telegram_id,
    username: r.username ?? undefined,
    firstName: r.first_name ?? undefined,
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
    day0Date: r.day0_date,
    programLength: r.program_length as ProgramLength,
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
      `insert into users (telegram_id, username, first_name)
       values ($1, $2, $3)
       on conflict (telegram_id) do update set telegram_id = excluded.telegram_id
       returning *`,
      [params.telegramId, params.username ?? null, params.firstName ?? null]
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
  day0Date?: string;
  programLength?: ProgramLength;
}): Promise<Mission> {
  return withUserContext(params.userId, async (client) => {
    // Cap enforcement (max MAX_ACTIVE_MISSIONS active missions per user) is
    // handled entirely by the `enforce_active_mission_limit` trigger
    // (migration 011) — deliberately not duplicated here as an app-level
    // count check, since that would reintroduce the TOCTOU race the trigger
    // closes. day0_date/program_length fall back to their column defaults
    // (current_date / 180) only if the caller omits them; later tasks'
    // bot/web call sites will always pass them explicitly.
    const r = await client.query(
      `insert into missions (user_id, title, description, directions, commitment_text, status, day0_date, program_length)
       values ($1, $2, $3, $4, $5, 'active', coalesce($6, current_date), coalesce($7, 180))
       returning *`,
      [
        params.userId,
        params.title,
        params.description ?? null,
        params.directions,
        params.commitmentText,
        params.day0Date ?? null,
        params.programLength ?? null,
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

/**
 * Returns all of a user's active missions, ordered oldest-first (ascending
 * by created_at, with id as a tiebreaker for deterministic ordering when
 * two missions share an identical created_at timestamp — e.g. bulk/seeded
 * inserts within the same clock tick) so call sites that need a single
 * "most recently active" pick can consistently take the *last* element,
 * and so new goals append to the end of any list UI.
 */
export async function getActiveMissions(userId: string): Promise<Mission[]> {
  return withUserContext(userId, async (client) => {
    const r = await client.query(
      "select * from missions where user_id = $1 and status = 'active' order by created_at asc, id asc",
      [userId]
    );
    return r.rows.map(mapMission);
  });
}

/**
 * Fetches a single mission scoped to `userId`, the same ownership pattern as
 * updateMissionStatus below: a mission id that exists but belongs to a
 * different user returns null rather than throwing or leaking that the row
 * exists. Needed by the `PATCH /api/missions/[id]` route (Task 17, not yet
 * built) and by GET /api/path's per-mission detail mode, which uses it to
 * key milestone/day-number calculations off that specific mission's
 * day0Date instead of assuming a single active mission.
 */
export async function getMissionById(userId: string, missionId: string): Promise<Mission | null> {
  return withUserContext(userId, async (client) => {
    const r = await client.query("select * from missions where id = $1 and user_id = $2", [
      missionId,
      userId,
    ]);
    return r.rowCount ? mapMission(r.rows[0]) : null;
  });
}

/**
 * Canonical status-transition graph for missions. Exported (not a local
 * const) so later call sites — e.g. an onboarding cap menu and the
 * `PATCH /api/missions/[id]` route — can reuse it for a 409 check without
 * redefining the graph.
 */
export const VALID_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  active: ["completed", "abandoned", "paused"],
  paused: ["active", "abandoned"],
  draft: ["active", "abandoned"],
  completed: [],
  abandoned: [],
};

/**
 * Bare status UPDATE — does NOT validate `status` against VALID_TRANSITIONS.
 * The caller is responsible for checking the transition is legal before
 * invoking this (e.g. the PATCH /api/missions/[id] route returning 409 on
 * an invalid transition); this function will happily write any status.
 */
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
    return mapTask(r.rows[0]);
    // main_task_id is intentionally no longer written here — see
    // listTasksForPlan / callers filtering by is_main_task instead.
    // Column kept on daily_plans (nullable, unused) per spec decision.
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
 * Cross-user poll for pending video jobs (status='uploaded' awaiting
 * pipeline processing, or 'confirmed' awaiting final render+publish).
 * Same withSystemContext rationale as listUsersForReminder — this has no
 * single owning user, so it must bypass per-user RLS deliberately, and
 * should only ever be called by the trusted worker process.
 */
export async function listVideoAssetsByStatus(status: VideoAssetStatus): Promise<VideoAsset[]> {
  return withSystemContext(async (client) => {
    const r = await client.query(
      "select * from video_assets where status = $1 order by created_at asc limit 5",
      [status]
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
export async function recoverStaleVideoJobs(staleMinutes = 15): Promise<number> {
  return withSystemContext(async (client) => {
    const r = await client.query(
      `update video_assets
       set status = case status
             when 'processing' then 'uploaded'
             when 'rendering' then 'confirmed'
           end,
           error_message = 'recovered after worker restart — retried automatically',
           updated_at = now()
       where status in ('processing', 'rendering')
         and updated_at < now() - ($1 || ' minutes')::interval
       returning id`,
      [staleMinutes]
    );
    return r.rowCount ?? 0;
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
       set status = $2, error_message = $3, updated_at = now()
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
 * Deletes the user's own row, which cascades (via `on delete cascade` on
 * every foreign key back to `users`) through every table this user owns —
 * the "delete my data" half of section 15. RLS's `users_self` policy
 * (migrations/002_rls.sql) permits a user to delete only their own row.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  await withUserContext(userId, (client) => client.query("delete from users where id = $1", [userId]));
}

