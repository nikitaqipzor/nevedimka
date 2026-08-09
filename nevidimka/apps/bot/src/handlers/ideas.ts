import { addIdea, listInboxIdeas } from "@nevidimka/db";
import { validateTextLength, type Idea } from "@nevidimka/shared-types";
import type { BotContext } from "../types.js";

export async function handleIdeaRequest(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = { kind: "idea" };
  await ctx.reply(
    "Напиши идею одним сообщением — сохраню в хранилище.\n" +
      "Не переключаемся на неё сейчас: сегодняшняя главная задача остаётся в силе."
  );
}

export async function handleIdeaText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "idea") return;
  const userId = ctx.session.userId!;

  const lengthError = validateTextLength("ideaText", text);
  if (lengthError) {
    await ctx.reply(lengthError);
    return; // stays in "idea" awaiting state — user can send a shorter version
  }

  await addIdea(userId, text);
  ctx.session.awaiting = undefined;

  await ctx.reply("Сохранено в хранилище идей. Возвращаемся к сегодняшней задаче — /today.");
}

export async function handleListIdeas(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const ideas = await listInboxIdeas(userId);
  if (!ideas.length) {
    await ctx.reply("Хранилище идей пусто.");
    return;
  }
  const lines = ideas.map((i: Idea) => `• ${i.text}`);
  await ctx.reply(`Идеи в хранилище (${ideas.length}):\n\n${lines.join("\n")}`);
}
