import { NextRequest, NextResponse } from "next/server";
import {
  addMentorMessage,
  getActiveMission,
  getOrCreateTodayPlan,
  getRecentPlans,
  getUserById,
  listMentorMessages,
  listTasksForPlan,
  logAiCall,
} from "@nevidimka/db";
import { AiRateLimitExceededError, chatWithMentor } from "@nevidimka/ai";
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

  const body = (await req.json().catch(() => null)) as { message?: string } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "message is required" }, { status: 400 });
  }
  const lengthError = validateTextLength("mentorMessage", message);
  if (lengthError) {
    return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
  }

  const [user, mission] = await Promise.all([getUserById(userId), getActiveMission(userId)]);
  if (!user || !mission) {
    return NextResponse.json({ code: "NO_ACTIVE_MISSION" }, { status: 422 });
  }

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
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
    const mainTask = yesterdayTasks.find((t) => t.isMainTask);
    yesterdayMainTaskTitle = mainTask?.title;
    yesterdayCompletionPercent = mainTask?.completionPercent ?? null;
  }
  const todayMainTask = todayTasks.find((t) => t.isMainTask);

  const history = await listMentorMessages(userId, 20);
  await addMentorMessage({ userId, role: "user", content: message });

  let mentorResult: Awaited<ReturnType<typeof chatWithMentor>>;
  try {
    mentorResult = await chatWithMentor(
      {
        context: {
          missionTitle: mission.title,
          dayNumber,
          programLength: user.programLength,
          yesterdayMainTaskTitle,
          yesterdayCompletionPercent,
          todayMainTaskTitle: todayMainTask?.title,
          todayMainTaskStatus: todayMainTask?.status,
        },
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
