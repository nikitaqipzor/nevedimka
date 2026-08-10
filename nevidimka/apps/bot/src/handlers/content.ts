import {
  addContentVersion,
  createContentDraft,
  createTextPublication,
  getActiveMissions,
  getContentDraft,
  getContentVersion,
  getUserById,
  listContentVersions,
  listEvidencesForUser,
  logAiCall,
  markPublicationFailed,
  markPublicationSent,
  setChosenVersion,
  setContentVersionPrivacyFlags,
  updateDraftStatus,
} from "@nevidimka/db";
import { checkPrivacy, editText } from "@nevidimka/ai";
import { formatChannelPost, sendChannelMessage, TelegramApiError } from "@nevidimka/telegram";
import { validateTextLength, type ContentVersionStep, type Mission, type User } from "@nevidimka/shared-types";
import {
  postConfirmKeyboard,
  postMissionPickKeyboard,
  postSourceKeyboard,
  postVersionsKeyboard,
} from "../keyboards.js";
import { dayNumberFor, todayInTimezone } from "../utils/dates.js";
import type { BotContext } from "../types.js";

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export async function handlePostRequest(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const evidences = await listEvidencesForUser(userId, 5);
  const options = evidences
    .filter((e) => e.rawText || e.transcript)
    .map((e) => ({ id: e.id, preview: truncate(e.rawText ?? e.transcript ?? "", 40) }));

  if (!options.length) {
    ctx.session.awaiting = { kind: "post_source_text" };
    await ctx.reply("Записей для поста пока нет. Напиши текст, из которого собрать пост:");
    return;
  }

  await ctx.reply("Из чего собрать пост?", { reply_markup: postSourceKeyboard(options) });
}

export async function handlePostSourceEvidence(ctx: BotContext, evidenceId: string): Promise<void> {
  const userId = ctx.session.userId!;
  const evidences = await listEvidencesForUser(userId, 20);
  const evidence = evidences.find((e) => e.id === evidenceId);
  const text = evidence?.rawText ?? evidence?.transcript;
  if (!text) {
    await ctx.reply("Не нашёл текст этой записи. Попробуй /post ещё раз.");
    return;
  }
  await startEditing(ctx, text, evidenceId);
}

export async function handlePostSourceNew(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = { kind: "post_source_text" };
  await ctx.reply("Напиши текст, из которого собрать пост:");
}

export async function handlePostSourceText(ctx: BotContext, text: string): Promise<void> {
  const lengthError = validateTextLength("postSourceText", text);
  if (lengthError) {
    await ctx.reply(lengthError);
    return; // stays in "post_source_text" awaiting state
  }
  ctx.session.awaiting = undefined;
  await startEditing(ctx, text);
}

async function startEditing(ctx: BotContext, sourceText: string, sourceEvidenceId?: string): Promise<void> {
  const userId = ctx.session.userId!;
  await ctx.reply("Готовлю варианты текста…");

  const draft = await createContentDraft({ userId, sourceText, sourceEvidenceId });
  await addContentVersion({ userId, draftId: draft.id, step: "original", text: sourceText });
  await updateDraftStatus(userId, draft.id, "editing");

  const { output, tokensIn, tokensOut, costUsd } = await editText({ sourceText }, userId);
  await logAiCall({
    userId,
    role: "text_editor",
    input: { draftId: draft.id },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });

  await addContentVersion({ userId, draftId: draft.id, step: "gentle", text: output.gentle });
  await addContentVersion({ userId, draftId: draft.id, step: "structured", text: output.structured });
  await addContentVersion({ userId, draftId: draft.id, step: "short", text: output.short });
  await updateDraftStatus(userId, draft.id, "ready_for_review");

  await ctx.reply(
    `Бережная:\n${output.gentle}\n\n` +
      `Структурная:\n${output.structured}\n\n` +
      `Краткая:\n${output.short}\n\n` +
      "Выбери версию:",
    { reply_markup: postVersionsKeyboard(draft.id) }
  );
}

export async function handlePostPick(
  ctx: BotContext,
  step: ContentVersionStep | "custom",
  draftId: string
): Promise<void> {
  if (step === "custom") {
    ctx.session.awaiting = { kind: "post_custom_final", draftId };
    await ctx.reply("Пришли свою версию текста для публикации:");
    return;
  }
  const userId = ctx.session.userId!;
  const versions = await listContentVersions(userId, draftId);
  const chosen = versions.find((v) => v.step === step);
  if (!chosen) {
    await ctx.reply("Не нашёл эту версию. Попробуй /post ещё раз.");
    return;
  }
  await finalizeVersion(ctx, draftId, chosen.text, chosen.id);
}

export async function handlePostCustomFinalText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "post_custom_final") return;

  const lengthError = validateTextLength("postSourceText", text);
  if (lengthError) {
    await ctx.reply(lengthError);
    return; // stays in "post_custom_final" awaiting state
  }

  ctx.session.awaiting = undefined;
  const userId = ctx.session.userId!;
  const version = await addContentVersion({
    userId,
    draftId: awaiting.draftId,
    step: "final",
    text,
  });
  await finalizeVersion(ctx, awaiting.draftId, text, version.id, /* alreadyFinal */ true);
}

/**
 * Runs the privacy check on the chosen text, writes the immutable 'final'
 * snapshot (unless the caller already wrote one — the custom-text path
 * does, to avoid an extra AI-free round trip), and shows the confirm step.
 * Nothing here publishes anything — that only happens in
 * handlePostPublish, on an explicit button press.
 */
async function finalizeVersion(
  ctx: BotContext,
  draftId: string,
  text: string,
  chosenVersionId: string,
  alreadyFinal = false
): Promise<void> {
  const userId = ctx.session.userId!;

  let finalVersionId = chosenVersionId;
  if (!alreadyFinal) {
    const finalVersion = await addContentVersion({ userId, draftId, step: "final", text });
    finalVersionId = finalVersion.id;
  }
  await setChosenVersion(userId, draftId, finalVersionId);

  const { output, tokensIn, tokensOut, costUsd } = await checkPrivacy({ text }, userId);
  await logAiCall({
    userId,
    role: "privacy_guard",
    input: { draftId },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });
  await setContentVersionPrivacyFlags(userId, finalVersionId, output.flags);

  let warningsText = "";
  if (output.flags.length) {
    warningsText =
      "\n\n⚠ Возможные риски:\n" + output.flags.map((f) => `• ${f.note}: «${f.excerpt}»`).join("\n");
  }

  await ctx.reply(`Финальный текст:\n\n${text}${warningsText}`, {
    reply_markup: postConfirmKeyboard(draftId),
  });
}

export async function handlePostCancel(ctx: BotContext, draftId: string): Promise<void> {
  const userId = ctx.session.userId!;
  await updateDraftStatus(userId, draftId, "failed");
  await ctx.reply("Публикация отменена. Черновик не отправлен.");
  await ctx.editMessageReplyMarkup().catch(() => {});
}

/**
 * Content drafts (see ContentDraft in packages/shared-types) don't carry a
 * missionId of their own — a draft is created from freeform evidence text
 * (startEditing) with no mission context at all, so there's no existing
 * per-draft attribution to fall back on. With multi-active-goals, a single
 * user can have more than one mission with status "active" at publish time,
 * so which mission's day-N counter/program length the post header should
 * use is genuinely ambiguous and has to be resolved explicitly:
 *   - 0 active missions: nothing to attribute to, refuse to publish.
 *   - 1 active mission: no ambiguity, publish straight through.
 *   - 2+ active missions: ask via postMissionPickKeyboard and resume in
 *     handlePostPublishMissionChoice once the user taps one. The in-flight
 *     draftId/versionId already round-trips through callback data on every
 *     other step of this flow (see postConfirmKeyboard etc.), so the picker
 *     follows the same pattern instead of adding new ctx.session state.
 *
 * A future migration adding a mission_id column to content_drafts (set at
 * creation time, e.g. from the mission the user was last acting on) would
 * remove this ambiguity entirely and let /post skip the picker altogether —
 * out of scope here per CLAUDE.md's migration-approval rule, flagged as a
 * follow-up.
 */
export async function handlePostPublish(ctx: BotContext, draftId: string): Promise<void> {
  const userId = ctx.session.userId!;
  const [user, missions] = await Promise.all([getUserById(userId), getActiveMissions(userId)]);
  if (!user) {
    await ctx.reply("Профиль не найден.");
    return;
  }
  if (missions.length === 0) {
    await ctx.reply("Нет активной цели — не к чему привязать пост. Начни новую через /addgoal.");
    return;
  }

  const channelId = user.channelId ?? process.env.TELEGRAM_CHANNEL_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!channelId || !botToken) {
    await ctx.reply("Канал не подключён. Настрой его в /settings или через TELEGRAM_CHANNEL_ID.");
    return;
  }

  if (missions.length > 1) {
    await ctx.reply("К какой цели отнести этот пост?", {
      reply_markup: postMissionPickKeyboard(draftId, missions),
    });
    return;
  }

  await publishDraftForMission(ctx, user, missions[0], draftId, channelId, botToken);
}

/**
 * Resumes the publish flow started by handlePostPublish's mission picker
 * (shown only when 2+ missions are active) once the user taps a specific
 * mission button. Re-fetches user + active missions rather than trusting
 * the callback's missionId blindly, so a mission that got paused/completed
 * between "show the picker" and "tap a button" is caught here instead of
 * silently attributing the post to a mission that's no longer active.
 */
export async function handlePostPublishMissionChoice(
  ctx: BotContext,
  draftId: string,
  missionId: string
): Promise<void> {
  const userId = ctx.session.userId!;
  const [user, missions] = await Promise.all([getUserById(userId), getActiveMissions(userId)]);
  if (!user) {
    await ctx.reply("Профиль не найден.");
    return;
  }
  const mission = missions.find((m) => m.id === missionId);
  if (!mission) {
    await ctx.reply("Эта цель больше не активна. Попробуй /post ещё раз.");
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }

  const channelId = user.channelId ?? process.env.TELEGRAM_CHANNEL_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!channelId || !botToken) {
    await ctx.reply("Канал не подключён. Настрой его в /settings или через TELEGRAM_CHANNEL_ID.");
    return;
  }

  await ctx.editMessageReplyMarkup().catch(() => {});
  await publishDraftForMission(ctx, user, mission, draftId, channelId, botToken);
}

async function publishDraftForMission(
  ctx: BotContext,
  user: User,
  mission: Mission,
  draftId: string,
  channelId: string,
  botToken: string
): Promise<void> {
  const userId = ctx.session.userId!;

  const draft = await getContentDraft(userId, draftId);
  if (!draft || !draft.chosenVersionId) {
    await ctx.reply("Не нашёл черновик для публикации.");
    return;
  }

  // Guard against a double-tap (or a redelivered Telegram callback) re-entering
  // this handler for the same draft: the unique index on publications only
  // rejects a second row once status='published', so two concurrent 'pending'
  // inserts both sail through and both get sent to the channel. Reading the
  // draft's status here — before doing anything irreversible — and bailing
  // out unless it's still "ready_for_review" closes that window; the
  // updateDraftStatus(...,"publishing") call right below flips the status as
  // the very first side effect so a second, near-simultaneous tap sees
  // "publishing" (not "ready_for_review") and stops here too.
  if (draft.status !== "ready_for_review") {
    if (draft.status === "publishing") {
      await ctx.reply("Пост уже публикуется, подожди немного.");
    } else if (draft.status === "published") {
      await ctx.reply("Этот пост уже опубликован.");
    } else {
      await ctx.reply("Черновик недоступен для публикации. Попробуй собрать пост заново через /post.");
    }
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }

  const version = await getContentVersion(userId, draft.chosenVersionId);
  if (!version) {
    await ctx.reply("Не нашёл финальный текст.");
    return;
  }

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(mission.day0Date, today);
  const html = formatChannelPost({ dayNumber, programLength: mission.programLength, text: version.text });

  await updateDraftStatus(userId, draftId, "publishing");
  const publication = await createTextPublication({
    userId,
    draftId,
    contentVersionId: version.id,
    channelId,
    publishedHtml: html,
  });

  try {
    const result = await sendChannelMessage({ botToken }, channelId, html);
    await markPublicationSent(userId, publication.id, result.messageId);
    await updateDraftStatus(userId, draftId, "published");
    await ctx.reply("Опубликовано в канале. Сохранено как доказательство прогресса.");
  } catch (err) {
    const message = err instanceof TelegramApiError ? err.message : "неизвестная ошибка";
    await markPublicationFailed(userId, publication.id, message);
    await updateDraftStatus(userId, draftId, "failed");
    await ctx.reply(`Не удалось опубликовать: ${message}. Попробуй ещё раз через /post.`);
  }
  await ctx.editMessageReplyMarkup().catch(() => {});
}
