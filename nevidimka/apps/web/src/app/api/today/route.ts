import { NextRequest, NextResponse } from "next/server";
import {
  createTask,
  addEvidence,
  endFocusSession,
  getActiveMission,
  getOrCreateTodayPlan,
  getRecentPlans,
  getTaskById,
  getUserById,
  listTasksForPlan,
  logAiCall,
  saveCheckIn,
  setPlanAiSummary,
  startFocusSession,
  updateTaskStatus,
} from "@nevidimka/db";
import { AiRateLimitExceededError, coachAction, planDay, reviewEvidence } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";
import { dayNumberFor, todayInTimezone } from "@/lib/dates";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const [user, mission] = await Promise.all([
    getUserById(session.userId),
    getActiveMission(session.userId),
  ]);
  if (!user) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
  if (!mission) return NextResponse.json({ state: "no_mission" });

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
  const plan = await getOrCreateTodayPlan(session.userId, today, dayNumber);
  const tasks = plan.checkIn ? await listTasksForPlan(session.userId, plan.id) : [];

  return NextResponse.json({
    state: plan.mainTaskId ? "ready" : plan.checkIn ? "no_plan_yet" : "needs_checkin",
    dayNumber,
    programLength: user.programLength,
    missionTitle: mission.title,
    userFirstName: user.firstName,
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
      const [user, mission] = await Promise.all([getUserById(userId), getActiveMission(userId)]);
      if (!user || !mission) {
        return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
      }
      const today = todayInTimezone(user.timezone);
      const dayNumber = dayNumberFor(user.day0Date, today);
      const plan = await getOrCreateTodayPlan(userId, today, dayNumber);

      await saveCheckIn(userId, plan.id, {
        sleepQuality: body.sleepQuality,
        energy: body.energy,
        mood: body.mood,
        stress: body.stress,
      });

      const recentPlans = await getRecentPlans(userId, 2);
      const yesterdayPlan = recentPlans.find((p) => p.id !== plan.id);
      let yesterdayMainTaskTitle: string | undefined;
      let yesterdayCompletionPercent: number | null | undefined;
      if (yesterdayPlan) {
        const yesterdayTasks = await listTasksForPlan(userId, yesterdayPlan.id);
        const mainTask = yesterdayTasks.find((t) => t.isMainTask);
        yesterdayMainTaskTitle = mainTask?.title;
        yesterdayCompletionPercent = mainTask?.completionPercent ?? null;
      }

      let planResult: Awaited<ReturnType<typeof planDay>>;
      try {
        planResult = await planDay(
          {
            userFirstName: user.firstName ?? "друг",
            dayNumber,
            programLength: user.programLength,
            missionTitle: mission.title,
            directions: mission.directions,
            yesterdayMainTaskTitle,
            yesterdayCompletionPercent,
            checkIn: { sleepQuality: body.sleepQuality, energy: body.energy, mood: body.mood, stress: body.stress },
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
      await logAiCall({ userId, role: "day_planner", input: { dayNumber }, output, tokensIn, tokensOut, costUsd });

      if ("error" in output) {
        return NextResponse.json({ code: "AI_NO_MISSION" }, { status: 422 });
      }

      await createTask({
        userId,
        dailyPlanId: plan.id,
        missionId: mission.id,
        title: output.main_task.title,
        isMainTask: true,
        estimateMinutes: output.main_task.estimate_minutes,
        direction: output.main_task.direction ?? undefined,
      });
      for (const t of output.additional_tasks) {
        await createTask({
          userId,
          dailyPlanId: plan.id,
          missionId: mission.id,
          title: t.title,
          isMainTask: false,
          estimateMinutes: t.estimate_minutes,
          direction: t.direction ?? undefined,
        });
      }
      await setPlanAiSummary(userId, plan.id, output.summary);
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
