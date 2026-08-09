import { getOrCreateTodayPlan, getUserById, listTasksForPlan, setEveningReview } from "@nevidimka/db";
import { validateTextLength, type DailyPlan } from "@nevidimka/shared-types";
import { dayNumberFor, todayInTimezone } from "../utils/dates.js";
import type { BotContext } from "../types.js";

/** Pure builder so jobs/evening.ts can send the identical summary proactively. */
export async function buildEveningSummaryMessage(userId: string, plan: DailyPlan): Promise<string> {
  const tasks = await listTasksForPlan(userId, plan.id);
  const lines = ["Итог дня:"];
  for (const t of tasks) {
    const pct = t.completionPercent != null ? ` — ${t.completionPercent}%` : "";
    lines.push(`  • ${t.title}: ${t.status}${pct}`);
  }
  lines.push("", "Пара слов — как прошёл день? (можно коротко)");
  return lines.join("\n");
}

export async function handleEveningRequest(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const user = await getUserById(userId);
  if (!user) {
    await ctx.reply("Не нашёл профиль, начни с /start.");
    return;
  }

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
  const plan = await getOrCreateTodayPlan(userId, today, dayNumber);

  if (!plan.mainTaskId) {
    await ctx.reply("Сегодняшний план ещё не сформирован. Сначала /today.");
    return;
  }

  const text = await buildEveningSummaryMessage(userId, plan);
  ctx.session.awaiting = { kind: "evening_review" };
  await ctx.reply(text);
}

export async function handleEveningReviewText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "evening_review") return;

  const lengthError = validateTextLength("eveningReviewNote", text);
  if (lengthError) {
    await ctx.reply(lengthError);
    return; // stays in "evening_review" awaiting state
  }

  const userId = ctx.session.userId!;
  const user = await getUserById(userId);
  if (!user) return;

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
  const plan = await getOrCreateTodayPlan(userId, today, dayNumber);

  await setEveningReview(userId, plan.id, text);
  ctx.session.awaiting = undefined;

  await ctx.reply(
    "Записано. День закрыт.\n\n" +
      "Завтра утром пришлю чек-ин, и по нему AI соберёт план на следующий день — " +
      "он всегда учитывает, что было сегодня."
  );
}
