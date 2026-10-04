import { Bot } from "grammy";
import { AiRateLimitExceededError } from "@nevidimka/ai";
import { getOrCreateUser } from "@nevidimka/db";
import { createLogger } from "@nevidimka/logger";
import { isOwnerTelegramId } from "@nevidimka/shared-types";
import { sessionMiddleware } from "./session.js";
import { sequentialize } from "./middlewares/sequentialize.js";
import type { BotContext } from "./types.js";
import * as onboarding from "./handlers/onboarding.js";
import * as today from "./handlers/today.js";
import * as focus from "./handlers/focus.js";
import * as report from "./handlers/report.js";
import * as ideasHandlers from "./handlers/ideas.js";
import * as evening from "./handlers/evening.js";
import * as coach from "./handlers/coach.js";
import * as content from "./handlers/content.js";
import * as tasks from "./handlers/tasks.js";
import * as video from "./handlers/video.js";
import * as settings from "./handlers/settings.js";
import * as privacy from "./handlers/privacy.js";

const log = createLogger("bot");

/**
 * Registers the command list with Telegram so the native "/" menu (the
 * icon next to the message input) shows every command with a short
 * description, instead of being empty. Without this, a user has zero
 * built-in discoverability and has to already know to type /help. Call
 * once at process startup, after createBot(); safe to call on every
 * startup — Telegram just overwrites the previous list.
 */
export async function registerBotCommands(bot: Bot<BotContext>): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Начать / посмотреть текущую миссию" },
    { command: "today", description: "План на сегодня" },
    { command: "evening", description: "Итог дня" },
    { command: "idea", description: "Сохранить мысль без переключения" },
    { command: "ideas", description: "Показать хранилище идей" },
    { command: "post", description: "Собрать и опубликовать пост" },
    { command: "video", description: "Собрать и опубликовать видео-пост" },
    { command: "settings", description: "Часовой пояс и время напоминаний" },
    { command: "export", description: "Скачать все свои данные" },
    { command: "delete", description: "Удалить аккаунт безвозвратно" },
    { command: "help", description: "Список команд" },
  ]);
}

export function createBot(token: string, options?: { apiRoot?: string }): Bot<BotContext> {
  const bot = new Bot<BotContext>(
    token,
    options?.apiRoot ? { client: { apiRoot: options.apiRoot } } : undefined
  );

  // Must run before sessionMiddleware (and everything else): it's what
  // makes concurrent webhook deliveries for the same chat safe to read and
  // write ctx.session at all. See middlewares/sequentialize.ts.
  bot.use(sequentialize());
  bot.use(sessionMiddleware);

  // Owner-only gate. PROJECT_SPEC.md's Release 1 scenario ("Никита") is a
  // single named user, and .env.example has always documented
  // OWNER_TELEGRAM_ID for this — but nothing actually enforced it: without
  // this check, anyone who discovered the bot's username could message it,
  // get a full account via the middleware below, and start consuming
  // Anthropic API credits (and, via /post or /video, attempt to publish
  // into the owner's private channel). Set OWNER_TELEGRAM_ID to restrict
  // the bot to one Telegram account. Production refuses to start without it;
  // an unset owner only permits multi-user fixtures in development/tests.
  const ownerTelegramId = process.env.OWNER_TELEGRAM_ID;
  if (ownerTelegramId || process.env.NODE_ENV === "production") {
    bot.use(async (ctx, next) => {
      if (!ctx.from || !isOwnerTelegramId(String(ctx.from.id))) {
        return; // silently ignore — no account is created, no reply is sent
      }
      await next();
    });
  }

  // Resolve (or create) the user row and stash its id in session before any
  // handler runs. Release 1 is single-user, but this keeps the door open
  // for more than one Telegram account without touching every handler.
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.session.userId) {
      const user = await getOrCreateUser({
        telegramId: String(ctx.from.id),
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      });
      ctx.session.userId = user.id;
    }
    await next();
  });

  // --- commands ---------------------------------------------------------
  bot.command("start", onboarding.startOnboarding);
  bot.command("today", today.handleToday);
  bot.command("evening", evening.handleEveningRequest);
  bot.command("idea", ideasHandlers.handleIdeaRequest);
  bot.command("ideas", ideasHandlers.handleListIdeas);
  bot.command("post", content.handlePostRequest);
  bot.command("video", video.handleVideoRequest);
  bot.command("settings", settings.handleSettingsRequest);
  bot.command("export", privacy.handleExportRequest);
  bot.command("delete", privacy.handleDeleteRequest);
  bot.command("report", async (ctx) => {
    await ctx.reply(
      "Через какую задачу? Открой /today и нажми «Отчитаться» под нужной задачей."
    );
  });
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "/today — план на сегодня\n" +
        "/evening — итог дня\n" +
        "/idea — сохранить мысль без переключения\n" +
        "/ideas — показать хранилище идей\n" +
        "/post — собрать и опубликовать пост в канал\n" +
        "/video — собрать и опубликовать видео-пост\n" +
        "/settings — часовой пояс и время напоминаний\n" +
        "/export — скачать все свои данные\n" +
        "/delete — удалить аккаунт безвозвратно"
    );
  });

  // --- callback queries (inline keyboard buttons) ------------------------
  bot.callbackQuery("onboarding:day0_confirm", async (ctx) => {
    await ctx.answerCallbackQuery();
    await onboarding.handleDay0Confirm(ctx);
  });
  bot.callbackQuery(/^onboarding:length:(180|365)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await onboarding.handleProgramLength(ctx, Number(ctx.match[1]) as 180 | 365);
  });
  bot.callbackQuery(/^onboarding:dir_toggle:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await onboarding.handleDirectionToggle(ctx, ctx.match[1]);
  });
  bot.callbackQuery("onboarding:dir_done", async (ctx) => {
    await ctx.answerCallbackQuery();
    await onboarding.handleDirectionsDone(ctx);
  });
  bot.callbackQuery("onboarding:mission_accept", async (ctx) => {
    await ctx.answerCallbackQuery();
    await onboarding.handleMissionAccept(ctx);
  });
  bot.callbackQuery("onboarding:mission_retry", async (ctx) => {
    await ctx.answerCallbackQuery();
    await onboarding.handleMissionRetry(ctx);
  });
  bot.callbackQuery(/^focus:start:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await focus.handleFocusStart(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^focus:stop:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await focus.handleFocusStop(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^coach:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await coach.handleCoachRequest(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^report:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await report.handleReportRequest(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^task:postpone:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await tasks.handleTaskPostpone(ctx, ctx.match[1]);
  });
  bot.callbackQuery("post:source:new", async (ctx) => {
    await ctx.answerCallbackQuery();
    await content.handlePostSourceNew(ctx);
  });
  bot.callbackQuery(/^post:source:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await content.handlePostSourceEvidence(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^post:pick:(gentle|structured|short|original|custom):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const step = ctx.match[1] as "gentle" | "structured" | "short" | "original" | "custom";
    await content.handlePostPick(ctx, step, ctx.match[2]);
  });
  bot.callbackQuery(/^post:publish:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await content.handlePostPublish(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^post:cancel:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await content.handlePostCancel(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^video:confirm:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await video.handleVideoConfirm(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/^video:cancel:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await video.handleVideoCancel(ctx, ctx.match[1]);
  });

  // --- text messages, routed by session.awaiting -------------------------
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const awaiting = ctx.session.awaiting;
    if (!awaiting) {
      await ctx.reply(
        "Не понял. /today — план на сегодня, /idea — сохранить мысль, /evening — итог дня."
      );
      return;
    }
    switch (awaiting.kind) {
      case "onboarding_commitment":
        await onboarding.handleCommitmentText(ctx, text);
        return;
      case "onboarding_goal":
        await onboarding.handleGoalText(ctx, text);
        return;
      case "onboarding_directions":
        await ctx.reply("Выбери направления кнопками выше, затем «Готово».");
        return;
      case "checkin":
        await today.handleCheckInText(ctx, text);
        return;
      case "report":
        await report.handleReportText(ctx, text);
        return;
      case "idea":
        await ideasHandlers.handleIdeaText(ctx, text);
        return;
      case "evening_review":
        await evening.handleEveningReviewText(ctx, text);
        return;
      case "action_coach":
        await coach.handleCoachText(ctx, text);
        return;
      case "post_source_text":
        await content.handlePostSourceText(ctx, text);
        return;
      case "post_custom_final":
        await content.handlePostCustomFinalText(ctx, text);
        return;
      case "settings_timezone":
        await settings.handleSettingsTimezoneText(ctx, text);
        return;
      case "settings_morning_hour":
        await settings.handleSettingsMorningHourText(ctx, text);
        return;
      case "settings_evening_hour":
        await settings.handleSettingsEveningHourText(ctx, text);
        return;
      case "delete_confirm":
        await privacy.handleDeleteConfirmText(ctx, text);
        return;
    }
  });

  // --- voice / video evidence ---------------------------------------------
  bot.on("message:voice", async (ctx) => {
    if (ctx.session.awaiting?.kind !== "report") {
      await ctx.reply(
        "Голосовое принимается только как отчёт по задаче — открой /today и нажми «Отчитаться»."
      );
      return;
    }
    await report.handleReportMedia(ctx, bot, ctx.message.voice.file_id, "voice", "ogg");
  });
  bot.on(["message:video_note", "message:video"], async (ctx) => {
    const awaiting = ctx.session.awaiting;
    if (awaiting?.kind === "video_upload" && ctx.message.video) {
      await video.handleVideoUpload(ctx, bot, ctx.message.video.file_id);
      return;
    }
    if (awaiting?.kind !== "report") {
      await ctx.reply(
        "Видео принимается либо как отчёт по задаче (открой /today → «Отчитаться»), " +
          "либо как материал для поста (команда /video)."
      );
      return;
    }
    const fileId = ctx.message.video_note?.file_id ?? ctx.message.video?.file_id;
    if (!fileId) return;
    await report.handleReportMedia(ctx, bot, fileId, "video", "mp4");
  });

  bot.catch((err) => {
    log.error({ err: err.error, userId: err.ctx.session?.userId }, "unhandled error in bot handler");
    // Best-effort — the user otherwise gets no response at all when a
    // handler throws (e.g. an AI call fails, a DB query errors out
    // outside the specific try/catches already in each handler).
    const message =
      err.error instanceof AiRateLimitExceededError
        ? err.error.message
        : "Что-то пошло не так. Попробуй ещё раз через минуту.";
    err.ctx.reply(message).catch(() => undefined);
  });

  return bot;
}
