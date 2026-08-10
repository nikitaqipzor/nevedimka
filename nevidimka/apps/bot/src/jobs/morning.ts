import {
  getActiveMissions,
  getOrCreateTodayPlan,
  getRecentPlans,
  listTasksForPlan,
  listUsersForReminder,
} from "@nevidimka/db";
import type { Bot } from "grammy";
import { createLogger } from "@nevidimka/logger";
import {
  buildCheckInPrompt,
  buildExistingPlanMessage,
  buildGeneratedPlanMessage,
} from "../handlers/today.js";
import { addDaysToDateString, dayNumberFor, todayInTimezone } from "../utils/dates.js";
import { readSession, writeSession } from "../session.js";
import type { BotContext } from "../types.js";

const log = createLogger("bot:jobs:morning");

const RETURN_NOTE =
  "Похоже, был перерыв в цикле. Это нормально — прогресс не обнуляется, " +
  "возвращаемся с сегодняшнего дня.\n\n";

export async function runMorningReminderJob(bot: Bot<BotContext>): Promise<void> {
  const users = await listUsersForReminder("morning");
  for (const user of users) {
    try {
      await sendMorningPing(bot, user);
    } catch (err) {
      log.error({ err, userId: user.id }, "morning reminder failed for user");
    }
  }
}

async function sendMorningPing(
  bot: Bot<BotContext>,
  user: Awaited<ReturnType<typeof listUsersForReminder>>[number]
): Promise<void> {
  const missions = await getActiveMissions(user.id);
  if (missions.length === 0) return; // still mid-onboarding — don't interrupt with reminders

  const today = todayInTimezone(user.timezone);
  const chatId = Number(user.telegramId);

  const recentPlans = await getRecentPlans(user.id, 3);
  const yesterday = addDaysToDateString(today, -1);
  const isReturning = recentPlans.length > 0 && recentPlans[0].date !== yesterday;

  // DailyPlan.dayNumber is a single legacy field on the plan row; with N
  // active missions there's no one "the" day number for the plan itself, so
  // the oldest active mission (missions[0], per getActiveMissions' stable
  // ordering) stands in as a representative value here, mirroring
  // handlers/today.ts's handleToday. Per-mission day numbers are computed
  // separately inside buildCheckInPrompt/buildGeneratedPlanMessage.
  const dayNumber = dayNumberFor(missions[0].day0Date, today);
  const plan = await getOrCreateTodayPlan(user.id, today, dayNumber);

  const existingTasks = await listTasksForPlan(user.id, plan.id);
  const mainTasks = existingTasks.filter((t) => t.isMainTask);
  if (mainTasks.length > 0) {
    const msg = await buildExistingPlanMessage(user.id, plan, mainTasks, missions);
    await bot.api.sendMessage(chatId, msg.text, { reply_markup: msg.keyboard });
    return;
  }

  if (plan.checkIn) {
    const msg = await buildGeneratedPlanMessage(user.id, user, missions, plan);
    await bot.api.sendMessage(chatId, msg.text, { reply_markup: msg.keyboard });
    const session = await readSession(user.telegramId);
    session.userId = user.id;
    session.awaiting = undefined;
    await writeSession(user.telegramId, session);
    return;
  }

  const prompt = (isReturning ? RETURN_NOTE : "") + buildCheckInPrompt(missions, today);
  await bot.api.sendMessage(chatId, prompt);

  const session = await readSession(user.telegramId);
  session.userId = user.id;
  session.awaiting = { kind: "checkin", planId: plan.id };
  await writeSession(user.telegramId, session);
}
