import {
  createTask,
  getActiveMission,
  getOrCreateTodayPlan,
  getRecentPlans,
  getUserById,
  listTasksForPlan,
  logAiCall,
  saveCheckIn,
  setPlanAiSummary,
} from "@nevidimka/db";
import { planDay } from "@nevidimka/ai";
import type { DailyCheckIn, DailyPlan, Mission, User } from "@nevidimka/shared-types";
import type { InlineKeyboard } from "grammy";
import { todayTaskKeyboard } from "../keyboards.js";
import { dayNumberFor, todayInTimezone } from "../utils/dates.js";
import type { BotContext } from "../types.js";

export interface OutboundMessage {
  text: string;
  keyboard?: InlineKeyboard;
}

/**
 * ctx-bound handler for the /today command. Pure message construction lives
 * in the exported *Message() builders below so jobs/morning.ts can send the
 * exact same content proactively via bot.api.sendMessage, without needing a
 * live ctx (there is no incoming update to attach one to on a cron tick).
 */
export async function handleToday(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const [user, mission] = await Promise.all([getUserById(userId), getActiveMission(userId)]);

  if (!user) {
    await ctx.reply("Не нашёл профиль, начни с /start.");
    return;
  }
  if (!mission) {
    await ctx.reply("Сначала нужно запустить систему: /start.");
    return;
  }

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
  const plan = await getOrCreateTodayPlan(userId, today, dayNumber);

  if (plan.mainTaskId) {
    const msg = await buildExistingPlanMessage(userId, plan);
    await ctx.reply(msg.text, { reply_markup: msg.keyboard });
    return;
  }

  if (plan.checkIn) {
    const msg = await buildGeneratedPlanMessage(userId, user, mission, plan);
    await ctx.reply(msg.text, { reply_markup: msg.keyboard });
    return;
  }

  ctx.session.awaiting = { kind: "checkin", planId: plan.id };
  await ctx.reply(buildCheckInPrompt(user, dayNumber));
}

export function buildCheckInPrompt(user: User, dayNumber: number): string {
  return (
    `Никита, день ${dayNumber} из ${user.programLength}.\n\n` +
    "Оцени по шкале 1-5 через пробел: сон, энергия, настроение, стресс.\n" +
    "Например: 4 3 3 2"
  );
}

export async function buildExistingPlanMessage(
  userId: string,
  plan: DailyPlan
): Promise<OutboundMessage> {
  const tasks = await listTasksForPlan(userId, plan.id);
  const mainTask = tasks.find((t) => t.isMainTask);
  const additional = tasks.filter((t) => !t.isMainTask);

  const lines = [plan.aiSummary ?? "План на сегодня:"];
  if (mainTask) {
    lines.push(`\nГлавная задача: ${mainTask.title} (${mainTask.status})`);
  }
  if (additional.length) {
    lines.push("\nДополнительно:");
    for (const t of additional) lines.push(`  • ${t.title} (${t.status})`);
  }

  return {
    text: lines.join("\n"),
    keyboard: mainTask ? todayTaskKeyboard(mainTask.id) : undefined,
  };
}

export function parseCheckIn(text: string): DailyCheckIn | null {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) {
    return null;
  }
  const [sleepQuality, energy, mood, stress] = parts;
  return { sleepQuality, energy, mood, stress };
}

export async function handleCheckInText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "checkin") return;

  const userId = ctx.session.userId!;
  const [user, mission] = await Promise.all([getUserById(userId), getActiveMission(userId)]);
  if (!user || !mission) {
    await ctx.reply("Что-то пошло не так с профилем. Попробуй /today ещё раз.");
    return;
  }
  const today = todayInTimezone(user.timezone);
  const plan = await getOrCreateTodayPlan(userId, today, dayNumberFor(user.day0Date, today));

  // grammy's session() plugin only persists ctx.session mutations if the
  // whole update handler resolves without throwing. saveCheckIn below is a
  // durable write that happens before the AI call inside
  // buildGeneratedPlanMessage (planDay) — if that call throws (rate limit,
  // parse error), the "awaiting = undefined" mutation from a previous
  // invocation gets silently discarded and reverts to "checkin", even though
  // the check-in was already saved. Re-derive from the DB (the source of
  // truth) instead of trusting a possibly-stale session: if this plan
  // already has a check-in, skip straight to showing the plan rather than
  // re-parsing/re-saving/re-running the AI call.
  if (plan.checkIn) {
    ctx.session.awaiting = undefined;
    const msg = await buildGeneratedPlanMessage(userId, user, mission, plan);
    await ctx.reply(msg.text, { reply_markup: msg.keyboard });
    return;
  }

  const checkIn = parseCheckIn(text);
  if (!checkIn) {
    await ctx.reply("Не понял формат. Пришли четыре числа 1-5 через пробел, например: 4 3 3 2");
    return;
  }

  await saveCheckIn(userId, plan.id, checkIn);
  ctx.session.awaiting = undefined;

  const msg = await buildGeneratedPlanMessage(userId, user, mission, plan);
  await ctx.reply(msg.text, { reply_markup: msg.keyboard });
}

export async function buildGeneratedPlanMessage(
  userId: string,
  user: User,
  mission: Mission,
  plan: DailyPlan
): Promise<OutboundMessage> {
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

  const { output, tokensIn, tokensOut, costUsd } = await planDay(
    {
      userFirstName: user.firstName ?? "друг",
      dayNumber: plan.dayNumber,
      programLength: user.programLength,
      missionTitle: mission.title,
      directions: mission.directions,
      yesterdayMainTaskTitle,
      yesterdayCompletionPercent,
      checkIn: plan.checkIn ?? {},
    },
    userId
  );
  await logAiCall({
    userId,
    role: "day_planner",
    input: { dayNumber: plan.dayNumber },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });

  if ("error" in output) {
    return { text: "AI не смог собрать план (нет активной цели). Проверь /start." };
  }

  const mainTask = await createTask({
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

  return {
    text: `${output.summary}\n\n${output.reasoning_note}`,
    keyboard: todayTaskKeyboard(mainTask.id),
  };
}
