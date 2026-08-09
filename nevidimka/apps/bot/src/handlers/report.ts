import { addEvidence, getTaskById, logAiCall, updateTaskStatus } from "@nevidimka/db";
import { reviewEvidence } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import type { Bot } from "grammy";
import { createLogger } from "@nevidimka/logger";
import { saveTelegramFile } from "../services/storage.js";
import { transcribeAudio } from "../services/asr.js";
import type { BotContext } from "../types.js";

const log = createLogger("bot:report");

export async function handleReportRequest(ctx: BotContext, taskId: string): Promise<void> {
  ctx.session.awaiting = { kind: "report", taskId };
  await ctx.reply(
    "Пришли отчёт: текстом, голосовым или видео-кружком.\n" +
      "Кратко — что сделано по факту."
  );
}

export async function handleReportText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "report") return;

  const lengthError = validateTextLength("reportText", text);
  if (lengthError) {
    await ctx.reply(lengthError);
    return; // stays in "report" awaiting state
  }

  await reviewAndReply(ctx, awaiting.taskId, text);
}

/**
 * Voice/video evidence path. ASR is intentionally not wired up in Release 1
 * (see services/asr.ts) — we still accept and store the file (nothing is
 * lost), but fall back to asking for a short text summary so the AI
 * reviewer has something to evaluate. The state stays `awaiting: "report"`
 * for the same taskId, so that follow-up text runs through the same
 * reviewEvidence() path as a pure-text report.
 */
export async function handleReportMedia(
  ctx: BotContext,
  bot: Bot<BotContext>,
  fileId: string,
  kind: "voice" | "video",
  extension: string
): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "report") return;
  const userId = ctx.session.userId!;

  const localPath = await saveTelegramFile(bot, fileId, extension);

  let transcript: string | undefined;
  try {
    transcript = await transcribeAudio(localPath);
  } catch (err) {
    // ASR is unimplemented in Release 1 (AsrNotConfiguredError, or the
    // "not implemented yet" error from services/asr.ts) — fall through and
    // store the evidence without a transcript rather than losing the file.
    log.warn({ err: (err as Error).message }, "transcription unavailable");
  }

  await addEvidence({
    userId,
    taskId: awaiting.taskId,
    kind,
    storagePath: localPath,
    transcript,
  });

  if (transcript) {
    await reviewAndReply(ctx, awaiting.taskId, transcript);
    return;
  }

  await ctx.reply(
    "Файл сохранён. Расшифровка голоса/видео пока не подключена в этой версии — " +
      "напиши в двух словах текстом, что сделано, и я оценю прогресс."
  );
  // awaiting stays "report" with the same taskId, so the next text message
  // is picked up by handleReportText above.
}

async function reviewAndReply(ctx: BotContext, taskId: string, reportText: string): Promise<void> {
  const userId = ctx.session.userId!;
  const task = await getTaskById(userId, taskId);
  if (!task) {
    await ctx.reply("Не нашёл задачу для этого отчёта. Попробуй /today.");
    ctx.session.awaiting = undefined;
    return;
  }

  // grammy's session() plugin only persists ctx.session mutations if the
  // whole update handler resolves without throwing. Below, addEvidence (a
  // durable write) happens before updateTaskStatus and the final ctx.reply,
  // both of which can still throw (DB hiccup, Telegram API error) — if
  // either does after a *previous* invocation already got as far as
  // updateTaskStatus, the "awaiting = undefined" mutation from that earlier
  // run is discarded and session.awaiting reverts to {kind:"report",
  // taskId}, so a later, unrelated text message would get misrouted back
  // into another paid AI review + duplicate evidence row. The task's status
  // (not the session) is the source of truth for whether this report was
  // already processed.
  if (task.status === "done" || task.status === "partially_done") {
    ctx.session.awaiting = undefined;
    await ctx.reply("Этот отчёт уже учтён, статус задачи обновлён. /today покажет план.");
    return;
  }

  const { output, tokensIn, tokensOut, costUsd } = await reviewEvidence(
    {
      taskTitle: task.title,
      taskEstimateMinutes: task.estimateMinutes,
      reportText,
    },
    userId
  );
  await logAiCall({
    userId,
    role: "result_reviewer",
    input: { taskId, reportText },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });

  await addEvidence({ userId, taskId, kind: "text", rawText: reportText });

  if (output.needs_clarification || output.completion_percent === null) {
    await ctx.reply(`${output.comment}\n\nМожешь уточнить, что именно сделано?`);
    return; // stay in "report" awaiting state for the clarification
  }

  ctx.session.awaiting = undefined;
  const percent = output.completion_percent; // non-null: guarded above
  const status = percent >= 100 ? "done" : "partially_done";
  await updateTaskStatus(userId, taskId, status, percent);

  await ctx.reply(
    `Оценка: ${percent}%.\n${output.comment}\n\n` +
      "Когда будешь готов подвести день — команда /evening."
  );
}
