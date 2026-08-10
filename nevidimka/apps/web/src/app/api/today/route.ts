import { NextRequest, NextResponse } from "next/server";
import {
  createTask,
  addEvidence,
  endFocusSession,
  getActiveMissions,
  getOrCreateTodayPlan,
  getTaskById,
  getUserById,
  listTasksForPlan,
  logAiCall,
  saveCheckIn,
  setPlanAiSummary,
  startFocusSession,
  updateTaskStatus,
} from "@nevidimka/db";
import { AiRateLimitExceededError, coachAction, planDayForMissions, reviewEvidence } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";
import { dayNumberFor, todayInTimezone } from "@/lib/dates";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const [user, missions] = await Promise.all([
    getUserById(session.userId),
    getActiveMissions(session.userId),
  ]);
  if (!user) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
  if (missions.length === 0) return NextResponse.json({ state: "no_mission" });

  const today = todayInTimezone(user.timezone);
  // DailyPlan.dayNumber is a single legacy field on the plan row; with N
  // active missions there's no one "the" day number for the plan itself, so
  // the oldest active mission (missions[0], per getActiveMissions' stable
  // created_at/id ordering) stands in as a representative value for
  // getOrCreateTodayPlan, same pattern as apps/bot/src/handlers/today.ts.
  // Per-mission day numbers are still returned below in `missions` for the
  // UI to render one gauge per goal.
  const dayNumber = dayNumberFor(missions[0].day0Date, today);
  const plan = await getOrCreateTodayPlan(session.userId, today, dayNumber);
  const tasks = plan.checkIn ? await listTasksForPlan(session.userId, plan.id) : [];

  // plan.mainTaskId is a legacy single-task field that createTask no longer
  // writes; with N active missions there can be N main tasks for one plan,
  // so "already planned" is determined by actually looking at the tasks
  // (mirrors apps/bot/src/handlers/today.ts).
  const mainTasks = tasks.filter((t) => t.isMainTask);

  return NextResponse.json({
    state: mainTasks.length > 0 ? "ready" : plan.checkIn ? "no_plan_yet" : "needs_checkin",
    userFirstName: user.firstName,
    missions: missions.map((m) => ({
      id: m.id,
      title: m.title,
      dayNumber: dayNumberFor(m.day0Date, today),
      programLength: m.programLength,
    })),
    plan: { id: plan.id, aiSummary: plan.aiSummary, checkIn: plan.checkIn },
    tasks,
  });
}

type TodayAction =
  | { action: "checkin"; sleepQuality: number; energy: number; mood: number; stress: number }
  | { action: "postpone"; taskId: string }
  | { action: "focus_start"; taskId: string }
  | { action: "focus_stop"; sessionId: string }
  | { action: "report"; taskId: string; text: string }
  | { action: "coach"; taskId: string; note?: string };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const body = (await req.json().catch(() => null)) as TodayAction | null;
  if (!body?.action) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "missing action" }, { status: 400 });
  }

  switch (body.action) {
    case "checkin": {
      const [user, missions] = await Promise.all([getUserById(userId), getActiveMissions(userId)]);
      if (!user || missions.length === 0) {
        return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
      }
      const today = todayInTimezone(user.timezone);
      // Representative day number for the plan row itself — see the GET
      // handler's comment above for why missions[0] is used here.
      const dayNumber = dayNumberFor(missions[0].day0Date, today);
      const plan = await getOrCreateTodayPlan(userId, today, dayNumber);

      await saveCheckIn(userId, plan.id, {
        sleepQuality: body.sleepQuality,
        energy: body.energy,
        mood: body.mood,
        stress: body.stress,
      });

      // Known limitation, same as apps/bot/src/handlers/today.ts:
      // yesterdayMainTaskTitle/yesterdayCompletionPercent are intentionally
      // omitted here — computing them per-mission would need a new
      // repository helper (yesterday's plan's tasks filtered by
      // mission_id) that doesn't exist yet. Both fields are optional on
      // DayPlannerForMissionsInput, so omitting them only reduces prompt
      // richness, it doesn't block correctness.
      let planResult: Awaited<ReturnType<typeof planDayForMissions>>;
      try {
        planResult = await planDayForMissions(
          {
            userFirstName: user.firstName ?? "друг",
            checkIn: { sleepQuality: body.sleepQuality, energy: body.energy, mood: body.mood, stress: body.stress },
            missions: missions.map((m) => ({
              missionId: m.id,
              missionTitle: m.title,
              directions: m.directions,
              dayNumber: dayNumberFor(m.day0Date, today),
              programLength: m.programLength,
            })),
          },
          userId
        );
      } catch (err) {
        if (err instanceof AiRateLimitExceededError) {
          return NextResponse.json(
            { code: "AI_RATE_LIMIT_EXCEEDED", message: err.message },
            { status: 429 }
          );
        }
        throw err;
      }
      const { output, tokensIn, tokensOut, costUsd } = planResult;
      await logAiCall({
        userId,
        role: "day_planner",
        input: { missionIds: missions.map((m) => m.id) },
        output,
        tokensIn,
        tokensOut,
        costUsd,
      });

      if ("error" in output) {
        return NextResponse.json({ code: "AI_NO_MISSION" }, { status: 422 });
      }

      const missionById = new Map(missions.map((m) => [m.id, m]));
      const summaryParts: string[] = [];
      // Same known limitation as the bot: if createTask throws partway
      // through this loop, the user is left with a partially-planned day
      // and no clean retry path. Out of scope here.
      for (const p of output.plans) {
        const mission = missionById.get(p.mission_id);
        if (!mission) {
          // AI-echoed mission_id doesn't match any mission we sent in the
          // request (hallucination/garbling) — skip rather than let
          // createTask hit a foreign-key failure.
          console.warn("planDayForMissions returned an unknown mission_id, skipping", {
            missionId: p.mission_id,
            knownMissionIds: [...missionById.keys()],
          });
          continue;
        }

        await createTask({
          userId,
          dailyPlanId: plan.id,
          missionId: p.mission_id,
          title: p.main_task.title,
          isMainTask: true,
          estimateMinutes: p.main_task.estimate_minutes,
          direction: p.main_task.direction ?? undefined,
        });
        summaryParts.push(`🎯 ${mission.title}\n${p.summary}\n${p.reasoning_note}`);
      }
      await setPlanAiSummary(userId, plan.id, summaryParts.join("\n\n"));
      return NextResponse.json({ ok: true });
    }

    case "postpone": {
      const task = await updateTaskStatus(userId, body.taskId, "postponed");
      return NextResponse.json({ ok: true, task });
    }

    case "focus_start": {
      const focusSession = await startFocusSession(userId, body.taskId);
      await updateTaskStatus(userId, body.taskId, "in_progress");
      return NextResponse.json({ ok: true, session: focusSession });
    }

    case "focus_stop": {
      const focusSession = await endFocusSession(userId, body.sessionId, false);
      return NextResponse.json({ ok: true, session: focusSession });
    }

    case "report": {
      const lengthError = validateTextLength("reportText", body.text);
      if (lengthError) {
        return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
      }
      const task = await getTaskById(userId, body.taskId);
      if (!task) return NextResponse.json({ code: "TASK_NOT_FOUND" }, { status: 404 });

      let reviewResult: Awaited<ReturnType<typeof reviewEvidence>>;
      try {
        reviewResult = await reviewEvidence(
          {
            taskTitle: task.title,
            taskEstimateMinutes: task.estimateMinutes,
            reportText: body.text,
          },
          userId
        );
      } catch (err) {
        if (err instanceof AiRateLimitExceededError) {
          return NextResponse.json(
            { code: "AI_RATE_LIMIT_EXCEEDED", message: err.message },
            { status: 429 }
          );
        }
        throw err;
      }
      const { output, tokensIn, tokensOut, costUsd } = reviewResult;
      await logAiCall({
        userId,
        role: "result_reviewer",
        input: { taskId: body.taskId, reportText: body.text },
        output,
        tokensIn,
        tokensOut,
        costUsd,
      });
      await addEvidence({ userId, taskId: body.taskId, kind: "text", rawText: body.text });

      if (output.needs_clarification || output.completion_percent === null) {
        return NextResponse.json({ ok: true, needsClarification: true, comment: output.comment });
      }
      const percent = output.completion_percent;
      const status = percent >= 100 ? "done" : "partially_done";
      const updated = await updateTaskStatus(userId, body.taskId, status, percent);
      return NextResponse.json({ ok: true, task: updated, comment: output.comment });
    }

    case "coach": {
      if (body.note) {
        const lengthError = validateTextLength("actionCoachNote", body.note);
        if (lengthError) {
          return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
        }
      }
      const task = await getTaskById(userId, body.taskId);
      if (!task) return NextResponse.json({ code: "TASK_NOT_FOUND" }, { status: 404 });

      let coachResult: Awaited<ReturnType<typeof coachAction>>;
      try {
        coachResult = await coachAction(
          {
            taskTitle: task.title,
            userNote: body.note,
          },
          userId
        );
      } catch (err) {
        if (err instanceof AiRateLimitExceededError) {
          return NextResponse.json(
            { code: "AI_RATE_LIMIT_EXCEEDED", message: err.message },
            { status: 429 }
          );
        }
        throw err;
      }
      const { output, tokensIn, tokensOut, costUsd } = coachResult;
      await logAiCall({
        userId,
        role: "action_coach",
        input: { taskId: body.taskId, note: body.note },
        output,
        tokensIn,
        tokensOut,
        costUsd,
      });
      return NextResponse.json({ ok: true, output });
    }

    default:
      return NextResponse.json({ code: "BAD_REQUEST", message: "unknown action" }, { status: 400 });
  }
}
