import { InputFile, type Bot } from "grammy";
import { unlink } from "node:fs/promises";
import {
  createVideoAsset,
  getLatestVideoRender,
  getVideoAsset,
  listVideoAssets,
  updateVideoAssetStatus,
} from "@nevidimka/db";
import type { VideoAsset } from "@nevidimka/shared-types";
import { createLogger } from "@nevidimka/logger";
import { saveTelegramFile } from "../services/storage.js";
import { videoConfirmKeyboard } from "../keyboards.js";
import type { BotContext } from "../types.js";

const log = createLogger("bot:video");

const STATUS_MESSAGE: Partial<Record<VideoAsset["status"], string>> = {
  uploaded: "Видео в очереди на обработку.",
  processing: "Обрабатываю: вырезаю паузы, привожу к вертикальному формату, нормализую звук.",
  confirmed: "Рендерю финальную версию и публикую — сообщу, когда будет готово.",
  rendering: "Рендерю финальную версию — почти готово.",
  published: "Уже опубликовано в канале.",
};

export async function handleVideoRequest(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const [latest] = await listVideoAssets(userId, 1);

  if (!latest || latest.status === "cancelled" || latest.status === "failed") {
    ctx.session.awaiting = { kind: "video_upload" };
    await ctx.reply(
      `Пришли видео (до 3 минут), из которого сделать пост.${
        latest?.status === "failed" ? "\n\n(Прошлая попытка не удалась — можно попробовать снова.)" : ""
      }`
    );
    return;
  }

  if (latest.status === "preview_ready") {
    await showPreview(ctx, latest);
    return;
  }

  await ctx.reply(STATUS_MESSAGE[latest.status] ?? "Обрабатываю видео.");
}

async function showPreview(ctx: BotContext, asset: VideoAsset): Promise<void> {
  const userId = ctx.session.userId!;
  const preview = await getLatestVideoRender(userId, asset.id, "preview");
  if (!preview) {
    await ctx.reply("Превью ещё не готово, попробуй чуть позже.");
    return;
  }

  await ctx.replyWithVideo(new InputFile(preview.storagePath), {
    caption: "Превью. Проверь перед публикацией — вертикальный формат и вырезанные паузы уже применены.",
    reply_markup: videoConfirmKeyboard(asset.id),
  });
}

export async function handleVideoUpload(
  ctx: BotContext,
  bot: Bot<BotContext>,
  fileId: string
): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "video_upload") return;
  const userId = ctx.session.userId!;
  ctx.session.awaiting = undefined;

  await ctx.reply("Видео получено, начинаю обработку — это может занять пару минут.");

  const localPath = await saveTelegramFile(bot, fileId, "mp4", "video");
  try {
    await createVideoAsset({ userId, originalStoragePath: localPath });
  } catch (err) {
    // DB insert failed after the file was already downloaded to disk — clean
    // up the orphaned file so it doesn't linger with no row referencing it.
    // grammy's session() plugin discards this update's ctx.session mutations
    // when the handler throws, so re-throwing below is what already sends
    // the user back to {kind:"video_upload"} — this catch only adds cleanup.
    try {
      await unlink(localPath);
    } catch (unlinkErr) {
      if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn(
          { err: (unlinkErr as Error).message, localPath },
          "failed to remove orphaned video file after createVideoAsset error"
        );
      }
    }
    throw err;
  }
  // apps/worker polls for status='uploaded' and picks this up; it will
  // message the user directly once the preview is ready (see
  // apps/worker/src/jobs.ts) — no further action needed here.
}

export async function handleVideoConfirm(ctx: BotContext, videoAssetId: string): Promise<void> {
  const userId = ctx.session.userId!;
  const asset = await getVideoAsset(userId, videoAssetId);
  // Same double-tap/stale-button guard as content.ts handlePostPublish: only
  // transition out of "preview_ready" once. Without this, a second tap (or a
  // redelivered callback) on the same preview would re-confirm an asset
  // that's already confirmed/rendering/published.
  if (!asset || asset.status !== "preview_ready") {
    await ctx.reply(
      (asset && STATUS_MESSAGE[asset.status]) ?? "Это превью уже не актуально."
    );
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }
  await updateVideoAssetStatus(userId, videoAssetId, "confirmed");
  await ctx.reply("Рендерю финальную версию и публикую — сообщу результат.");
  await ctx.editMessageReplyMarkup().catch(() => {});
}

export async function handleVideoCancel(ctx: BotContext, videoAssetId: string): Promise<void> {
  const userId = ctx.session.userId!;
  const asset = await getVideoAsset(userId, videoAssetId);
  if (!asset || asset.status !== "preview_ready") {
    await ctx.reply("Это превью уже не актуально.");
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }
  await updateVideoAssetStatus(userId, videoAssetId, "cancelled");
  await ctx.reply("Отменено. Публикация не отправлена.");
  await ctx.editMessageReplyMarkup().catch(() => {});
}
