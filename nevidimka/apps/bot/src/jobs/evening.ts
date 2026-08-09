import {
  getActiveMission,
  getOrCreateTodayPlan,
  listUsersForReminder,
} from "@nevidimka/db";
import type { Bot } from "grammy";
import { createLogger } from "@nevidimka/logger";
import { buildEveningSummaryMessage } from "../handlers/evening.js";
import { dayNumberFor, todayInTimezone } from "../utils/dates.js";
import { readSession, writeSession } from "../session.js";
import type { BotContext } from "../types.js";

const log = createLogger("bot:jobs:evening");

export async function runEveningReminderJob(bot: Bot<BotContext>): Promise<void> {
  const users = await listUsersForReminder("evening");
  for (const user of users) {
    try {
      await sendEveningPing(bot, user);
    } catch (err) {
      log.error({ err, userId: user.id }, "evening reminder failed for user");
    }
  }
}

async function sendEveningPing(
  bot: Bot<BotContext>,
  user: Awaited<ReturnType<typeof listUsersForReminder>>[number]
): Promise<void> {
  const mission = await getActiveMission(user.id);
  if (!mission) return;

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
  const plan = await getOrCreateTodayPlan(user.id, today, dayNumber);

  if (!plan.mainTaskId) return; // no plan was generated today — nothing to review
  if (plan.eveningReviewNote) return; // already reviewed (e.g. user ran /evening manually)

  const text = await buildEveningSummaryMessage(user.id, plan);
  const chatId = Number(user.telegramId);
  await bot.api.sendMessage(chatId, text);

  const session = await readSession(user.telegramId);
  session.userId = user.id;
  session.awaiting = { kind: "evening_review" };
  await writeSession(user.telegramId, session);
}
