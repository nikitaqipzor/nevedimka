import { NextRequest, NextResponse } from "next/server";
import {
  addMentorMessage,
  getActiveMissions,
  getOrCreateTodayPlan,
  getRecentPlans,
  getUserById,
  listMentorMessages,
  listTasksForPlan,
  logAiCall,
} from "@nevidimka/db";
import { AiRateLimitExceededError, chatWithMentor, type MentorChatInput } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";
import { dayNumberFor, todayInTimezone } from "@/lib/dates";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const messages = await listMentorMessages(session.userId, 50);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const body = (await req.json().catch(() => null)) as { message?: string; missionId?: string } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "message is required" }, { status: 400 });
  }
  const lengthError = validateTextLength("mentorMessage", message);
  if (lengthError) {
    return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
  }

  const [user, missions] = await Promise.all([getUserById(userId), getActiveMissions(userId)]);
  if (!user) {
    return NextResponse.json({ code: "NO_ACTIVE_MISSION" }, { status: 422 });
  }

  // Resolve which mission (if any) this message is about:
  // - explicit missionId: must match one of the user's own active missions
  //   (reject rather than trust an arbitrary/stale id blindly);
  // - no missionId + exactly one active mission: unambiguous, use it;
  // - no missionId + 0 active missions: existing "no mission" behavior;
  // - no missionId + 2+ active missions: no single mission to frame around,
  //   fall back to a multi-goal summary context instead of forcing a pick.
  let mission: (typeof missions)[number] | undefined;
  if (body?.missionId) {
    mission = missions.find((m) => m.id === body.missionId);
    if (!mission) {
      return NextResponse.json({ code: "MISSION_NOT_FOUND" }, { status: 404 });
    }
  } else if (missions.length === 1) {
    mission = missions[0];
  } else if (missions.length === 0) {
    return NextResponse.json({ code: "NO_ACTIVE_MISSION" }, { status: 422 });
  }

  let context: MentorChatInput["context"];
  if (mission) {
    const resolvedMission = mission;
    const today = todayInTimezone(user.timezone);
    const dayNumber = dayNumberFor(resolvedMission.day0Date, today);
    const plan = await getOrCreateTodayPlan(userId, today, dayNumber);
    const [recentPlans, todayTasks] = await Promise.all([
      getRecentPlans(userId, 2),
      plan.checkIn ? listTasksForPlan(userId, plan.id) : Promise.resolve([]),
    ]);
    const yesterdayPlan = recentPlans.find((p) => p.id !== plan.id);
    let yesterdayMainTaskTitle: string | undefined;
    let yesterdayCompletionPercent: number | null | undefined;
    if (yesterdayPlan) {
      const yesterdayTasks = await listTasksForPlan(userId, yesterdayPlan.id);
      const mainTask = yesterdayTasks.find((t) => t.isMainTask && t.missionId === resolvedMission.id);
      yesterdayMainTaskTitle = mainTask?.title;
      yesterdayCompletionPercent = mainTask?.completionPercent ?? null;
    }
    const todayMainTask = todayTasks.find((t) => t.isMainTask && t.missionId === resolvedMission.id);

    context = {
      missionTitle: resolvedMission.title,
      dayNumber,
      programLength: resolvedMission.programLength,
      yesterdayMainTaskTitle,
      yesterdayCompletionPercent,
      todayMainTaskTitle: todayMainTask?.title,
      todayMainTaskStatus: todayMainTask?.status,
    };
  } else {
    // 2+ active missions, no missionId specified — multi-goal summary mode.
    context = { activeMissionTitles: missions.map((m) => m.title) };
  }

  const history = await listMentorMessages(userId, 20);
  await addMentorMessage({ userId, role: "user", content: message });

  let mentorResult: Awaited<ReturnType<typeof chatWithMentor>>;
  try {
    mentorResult = await chatWithMentor(
      {
        context,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        message,
      },
      userId
    );
  } catch (err) {
    if (err instanceof AiRateLimitExceededError) {
      return NextResponse.json({ code: "AI_RATE_LIMIT_EXCEEDED", message: err.message }, { status: 429 });
    }
    throw err;
  }
  const { output, tokensIn, tokensOut, costUsd } = mentorResult;
  await logAiCall({ userId, role: "orchestrator", input: { message }, output, tokensIn, tokensOut, costUsd });

  const assistantMessage = await addMentorMessage({
    userId,
    role: "assistant",
    content: output.reply,
  });

  return NextResponse.json({ ok: true, reply: assistantMessage });
}
