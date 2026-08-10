import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createVideoCutPlan,
  createVideoPublication,
  createVideoRender,
  createVideoTranscript,
  getActiveMissions,
  getLatestVideoRender,
  getUserById,
  markPublicationFailed,
  markPublicationSent,
  setVideoAssetProbe,
  updateVideoAssetStatus,
} from "@nevidimka/db";
import type { VideoAsset } from "@nevidimka/shared-types";
import { probeVideo, runFinalRender, runPipelineToPreview } from "@nevidimka/video";
import { sendChannelMessage, sendChannelVideo, TelegramApiError } from "@nevidimka/telegram";
import { createLogger } from "@nevidimka/logger";
import { dayNumberFor, todayInTimezone } from "./dates.js";
import { masterPathFor, outputDirFor, workDirFor } from "./storage.js";

const log = createLogger("worker:jobs");

const botToken = process.env.TELEGRAM_BOT_TOKEN;

function requireBotToken(): string {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return botToken;
}

async function notifyUser(telegramId: string, text: string): Promise<void> {
  try {
    await sendChannelMessage({ botToken: requireBotToken() }, telegramId, text);
  } catch (err) {
    log.error({ err, telegramId }, "failed to notify user");
  }
}

/** Stage 1: uploaded → preview_ready (or failed). No confirmation needed to run this far. */
export async function processUploadedAsset(asset: VideoAsset): Promise<void> {
  const user = await getUserById(asset.userId);
  if (!user) {
    await updateVideoAssetStatus(asset.userId, asset.id, "failed", "user not found");
    return;
  }

  const workDir = workDirFor(asset.id);
  const outputDir = outputDirFor(asset.id);

  try {
    await updateVideoAssetStatus(asset.userId, asset.id, "processing");
    await mkdir(workDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    const result = await runPipelineToPreview(asset.originalStoragePath, workDir);

    if (result.transcript) {
      // Best-effort: subtitles (the transcript's primary use) already
      // happened in-memory inside runPipelineToPreview, so a failure to
      // persist this record must not fail a pipeline run that otherwise
      // succeeded — it would only mean a retry re-pays for transcription.
      try {
        await createVideoTranscript({
          userId: asset.userId,
          videoAssetId: asset.id,
          fullText: result.transcript.fullText,
          segments: result.transcript.segments,
        });
      } catch (err) {
        log.warn({ err, assetId: asset.id }, "failed to persist video transcript, continuing");
      }
    }

    const masterPath = masterPathFor(asset.id);
    await copyFile(result.processedPath, masterPath);

    const previewPath = join(outputDir, "preview.mp4");
    const coverPath = join(outputDir, "cover.jpg");
    await copyFile(result.previewPath, previewPath);
    await copyFile(result.coverPath, coverPath);

    const previewProbe = await probeVideo(previewPath);

    await createVideoCutPlan({
      userId: asset.userId,
      videoAssetId: asset.id,
      cuts: result.cuts,
      source: "silence_detection",
    });
    await createVideoRender({
      userId: asset.userId,
      videoAssetId: asset.id,
      kind: "preview",
      storagePath: previewPath,
      coverPath,
      width: previewProbe.width,
      height: previewProbe.height,
      durationSeconds: previewProbe.durationSeconds,
    });
    await setVideoAssetProbe(asset.userId, asset.id, {
      durationSeconds: result.probe.durationSeconds,
      width: result.probe.width,
      height: result.probe.height,
    });
    await updateVideoAssetStatus(asset.userId, asset.id, "preview_ready");

    const cutsNote = result.cuts.length
      ? `Убрал ${result.cuts.length} пауз(ы) — сэкономил ${result.cuts
          .reduce((sum, c) => sum + (c.end - c.start), 0)
          .toFixed(1)}с.`
      : "Пауз для вырезки не нашлось.";
    const subtitlesNote = result.transcript
      ? "Субтитры добавлены."
      : "Расшифровка (и субтитры) пока не подключены в этой версии.";

    await notifyUser(
      user.telegramId,
      `Превью готово.\n${cutsNote}\n${subtitlesNote}\n\n` +
        "Открой /video в боте, чтобы посмотреть и подтвердить публикацию."
    );
  } catch (err) {
    const message = (err as Error).message;
    log.error({ err, assetId: asset.id }, "pipeline failed for video asset");
    await updateVideoAssetStatus(asset.userId, asset.id, "failed", message);
    await notifyUser(user.telegramId, `Не получилось обработать видео: ${message}`);
  }
}

/** Stage 2: confirmed → rendering → published (or failed). Only runs after explicit user confirmation. */
export async function processConfirmedAsset(asset: VideoAsset): Promise<void> {
  const user = await getUserById(asset.userId);
  if (!user) {
    await updateVideoAssetStatus(asset.userId, asset.id, "failed", "user not found");
    return;
  }
  const channelId = user.channelId ?? process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) {
    await updateVideoAssetStatus(asset.userId, asset.id, "failed", "no channel connected");
    await notifyUser(user.telegramId, "Канал не подключён. Настрой его в /settings или через TELEGRAM_CHANNEL_ID.");
    return;
  }

  const outputDir = outputDirFor(asset.id);

  try {
    await updateVideoAssetStatus(asset.userId, asset.id, "rendering");
    const masterPath = masterPathFor(asset.id);
    const finalPath = join(outputDir, "final.mp4");
    await runFinalRender(masterPath, finalPath);
    const finalProbe = await probeVideo(finalPath);

    const previewRender = await getLatestVideoRender(asset.userId, asset.id, "preview");
    const finalRender = await createVideoRender({
      userId: asset.userId,
      videoAssetId: asset.id,
      kind: "final",
      storagePath: finalPath,
      coverPath: previewRender?.coverPath,
      width: finalProbe.width,
      height: finalProbe.height,
      durationSeconds: finalProbe.durationSeconds,
    });

    const missions = await getActiveMissions(asset.userId);
    const today = todayInTimezone(user.timezone);
    const captionHtml =
      missions.length > 0
        ? `<b>День ${dayNumberFor(missions[missions.length - 1].day0Date, today)} из ${missions[missions.length - 1].programLength}</b>`
        : "";

    const publication = await createVideoPublication({
      userId: asset.userId,
      videoAssetId: asset.id,
      videoRenderId: finalRender.id,
      channelId,
      publishedHtml: captionHtml,
    });

    try {
      const sent = await sendChannelVideo({ botToken: requireBotToken() }, channelId, finalPath, {
        captionHtml,
        coverPath: previewRender?.coverPath,
      });
      await markPublicationSent(asset.userId, publication.id, sent.messageId);
      await updateVideoAssetStatus(asset.userId, asset.id, "published");
      await notifyUser(user.telegramId, "Видео опубликовано в канале. Сохранено как доказательство прогресса.");
    } catch (err) {
      const message = err instanceof TelegramApiError ? err.message : (err as Error).message;
      await markPublicationFailed(asset.userId, publication.id, message);
      await updateVideoAssetStatus(asset.userId, asset.id, "failed", message);
      await notifyUser(user.telegramId, `Не удалось опубликовать видео: ${message}`);
    }
  } catch (err) {
    const message = (err as Error).message;
    log.error({ err, assetId: asset.id }, "final render failed for video asset");
    await updateVideoAssetStatus(asset.userId, asset.id, "failed", message);
    await notifyUser(user.telegramId, `Не удалось подготовить финальное видео: ${message}`);
  }
}
