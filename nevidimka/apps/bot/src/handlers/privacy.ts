import { InputFile } from "grammy";
import { deleteUserAccount, exportUserData } from "@nevidimka/db";
import type { BotContext } from "../types.js";

export async function handleExportRequest(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const data = await exportUserData(userId);
  const json = JSON.stringify(data, null, 2);
  const filename = `nevidimka-export-${new Date().toISOString().slice(0, 10)}.json`;

  await ctx.replyWithDocument(new InputFile(Buffer.from(json, "utf8"), filename), {
    caption: "Все твои данные — миссия, задачи, дневник, идеи, публикации — в одном файле.",
  });
}

export async function handleDeleteRequest(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = { kind: "delete_confirm" };
  await ctx.reply(
    "Это необратимо: удалит миссию, все задачи, дневник, идеи и историю " +
      "публикаций без возможности восстановить.\n\n" +
      "Напиши DELETE, чтобы подтвердить, или что угодно другое — чтобы отменить."
  );
}

export async function handleDeleteConfirmText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "delete_confirm") return;
  ctx.session.awaiting = undefined;

  if (text.trim() !== "DELETE") {
    await ctx.reply("Отменено. Данные не тронуты.");
    return;
  }

  const userId = ctx.session.userId!;
  await deleteUserAccount(userId);
  ctx.session.userId = undefined;
  await ctx.reply("Аккаунт и все данные удалены. Напиши /start, если захочешь начать заново.");
}
