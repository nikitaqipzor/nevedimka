import { endFocusSession, startFocusSession, updateTaskStatus } from "@nevidimka/db";
import { focusActiveKeyboard } from "../keyboards.js";
import type { BotContext } from "../types.js";

export async function handleFocusStart(ctx: BotContext, taskId: string): Promise<void> {
  const userId = ctx.session.userId!;
  const session = await startFocusSession(userId, taskId);
  await updateTaskStatus(userId, taskId, "in_progress");
  await ctx.reply(
    "Фокус начат. Отложи остальное — сейчас только эта задача.\n\n" +
      "Когда закончишь (или прервёшься), нажми «Завершить фокус».",
    { reply_markup: focusActiveKeyboard(session.id) }
  );
}

export async function handleFocusStop(ctx: BotContext, sessionId: string): Promise<void> {
  const userId = ctx.session.userId!;
  const session = await endFocusSession(userId, sessionId, false);
  const minutes = session.durationSeconds ? Math.round(session.durationSeconds / 60) : 0;
  await ctx.reply(
    `Фокус-сессия завершена: ${minutes} мин.\n\n` +
      "Когда будешь готов — пришли отчёт о результате (кнопка «Отчитаться» под задачей, или команда /report)."
  );
}
