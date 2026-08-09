import { updateTaskStatus } from "@nevidimka/db";
import type { BotContext } from "../types.js";

export async function handleTaskPostpone(ctx: BotContext, taskId: string): Promise<void> {
  const userId = ctx.session.userId!;
  const task = await updateTaskStatus(userId, taskId, "postponed");
  await ctx.reply(
    `«${task.title}» перенесена. Перенос не отменяет прогресс — просто честная фиксация факта.\n` +
      "Открой /today, если хочешь скорректировать план."
  );
}
