import {
  getActiveMission,
  getOrCreateTodayPlan,
  getRecentPlans,
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
  const mission = await getActiveMission(user.id);
  if (!mission) return; // still mid-onboarding — don't interrupt with reminders

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
  const chatId = Number(user.telegramId);

  const recentPlans = await getRecentPlans(user.id, 3);
  const yesterday = addDaysToDateString(today, -1);
  const isReturning = recentPlans.length > 0 && recentPlans[0].date !== yesterday;

  const plan = await getOrCreateTodayPlan(user.id, today, dayNumber);

  if (plan.mainTaskId) {
    const msg = await buildExistingPlanMessage(user.id, plan);
    await bot.api.sendMessage(chatId, msg.text, { reply_markup: msg.keyboard });
    return;
  }

  if (plan.checkIn) {
    const msg = await buildGeneratedPlanMessage(user.id, user, mission, plan);
    await bot.api.sendMessage(chatId, msg.text, { reply_markup: msg.keyboard });
    const session = await readSession(user.telegramId);
    session.userId = user.id;
    session.awaiting = undefined;
    await writeSession(user.telegramId, session);
    return;
  }

  const prompt = (isReturning ? RETURN_NOTE : "") + buildCheckInPrompt(user, dayNumber);
  await bot.api.sendMessage(chatId, prompt);

  const session = await readSession(user.telegramId);
  session.userId = user.id;
  session.awaiting = { kind: "checkin", planId: plan.id };
  await writeSession(user.telegramId, session);
}
