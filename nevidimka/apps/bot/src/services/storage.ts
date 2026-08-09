import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bot } from "grammy";
import type { BotContext } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/bot/storage/evidence — kept outside src/ so it survives `tsc` builds.
const EVIDENCE_DIR = join(__dirname, "..", "..", "storage", "evidence");

/**
 * Downloads a Telegram file (voice/video note) via the Bot API and stores
 * it locally. This is a Release-1 placeholder: swap for a Supabase Storage
 * (or S3-compatible) upload once Release 2 needs signed URLs shared with
 * the Mini App — the call site (handlers/report.ts) only depends on this
 * function's signature, not its implementation.
 */
export async function saveTelegramFile(
  bot: Bot<BotContext>,
  fileId: string,
  extension: string
): Promise<string> {
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file_path for this file_id");
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download Telegram file: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const localPath = join(EVIDENCE_DIR, `${randomUUID()}.${extension}`);
  await writeFile(localPath, buffer);
  return localPath;
}
