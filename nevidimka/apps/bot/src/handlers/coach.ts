import { getTaskById, logAiCall } from "@nevidimka/db";
import { coachAction } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import type { BotContext } from "../types.js";

export async function handleCoachRequest(ctx: BotContext, taskId: string): Promise<void> {
  ctx.session.awaiting = { kind: "action_coach", taskId };
  await ctx.reply("Коротко: на чём застрял? (или пришли «-», чтобы просто разбить задачу на шаги)");
}

export async function handleCoachText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "action_coach") return;
  const userId = ctx.session.userId!;
  const isSkip = text.trim() === "-";

  if (!isSkip) {
    const lengthError = validateTextLength("actionCoachNote", text);
    if (lengthError) {
      await ctx.reply(lengthError);
      return;
    }
  }

  const task = await getTaskById(userId, awaiting.taskId);
  if (!task) {
    await ctx.reply("Не нашёл задачу. Попробуй /today.");
    ctx.session.awaiting = undefined;
    return;
  }

  const { output, tokensIn, tokensOut, costUsd } = await coachAction(
    {
      taskTitle: task.title,
      userNote: isSkip ? undefined : text,
    },
    userId
  );
  await logAiCall({
    userId,
    role: "action_coach",
    input: { taskId: awaiting.taskId, note: text },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });
  ctx.session.awaiting = undefined;

  const lines = [`Первый шаг (5-10 мин): ${output.first_step}`];
  if (output.subtasks.length) {
    lines.push("", "Дальше:");
    for (const s of output.subtasks) lines.push(`  • ${s}`);
  }
  if (output.note) lines.push("", output.note);

  await ctx.reply(lines.join("\n"));
}
