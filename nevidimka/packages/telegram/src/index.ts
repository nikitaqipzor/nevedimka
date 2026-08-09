export interface TelegramClientOptions {
  botToken: string;
  /** Override for tests — defaults to the real Telegram Bot API. */
  apiBaseUrl?: string;
}

export class TelegramApiError extends Error {
  constructor(
    public method: string,
    message: string,
    public errorCode?: number
  ) {
    super(`Telegram API ${method} failed: ${message}`);
    this.name = "TelegramApiError";
  }
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Builds a Telegram Bot API request URL. Shared by callTelegramApi (JSON
 * requests) and sendChannelVideo (multipart, which must bypass
 * callTelegramApi) so this base-URL/token/method logic exists in exactly
 * one place — a past "lost line" bug in this exact logic once broke every
 * Telegram API call, caught only by real HTTP testing.
 */
function buildTelegramUrl(botToken: string, method: string, apiBaseUrl?: string): string {
  const base = apiBaseUrl ?? process.env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org";
  return `${base}/bot${botToken}/${method}`;
}

async function callTelegramApi<T>(
  opts: TelegramClientOptions,
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  const url = buildTelegramUrl(opts.botToken, method, opts.apiBaseUrl);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = (await res.json()) as TelegramApiResponse<T>;

  if (!data.ok || data.result === undefined) {
    throw new TelegramApiError(method, data.description ?? "unknown error", data.error_code);
  }
  return data.result;
}

/** Escapes the subset of characters that break Telegram's HTML parse_mode. */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Assembles the final channel post: a day-marker header (matching the
 * bot's existing "День N из M" voice) plus the confirmed body text, HTML-
 * escaped. This is PROJECT_SPEC.md's "Агент упаковки публикации" role,
 * implemented as plain formatting rather than an LLM call — assembling a
 * fixed structural header from numbers that are already computed
 * elsewhere doesn't need judgment, per section 10's "numbers are computed
 * by code" principle. If Release 4 adds video metadata to the packed post,
 * this may need to become a real AI call — revisit then, not before.
 */
export function formatChannelPost(params: {
  dayNumber: number;
  programLength: number;
  text: string;
}): string {
  const header = `<b>День ${params.dayNumber} из ${params.programLength}</b>`;
  const body = escapeTelegramHtml(params.text);
  return `${header}\n\n${body}`;
}

export interface TelegramSendResult {
  messageId: number;
}

/**
 * Sends a message to any chat_id — a channel, a group, or a user's private
 * chat (e.g. progress notifications from apps/worker back to the person
 * who uploaded a video). Telegram's sendMessage endpoint doesn't
 * distinguish between these; only the chat_id differs.
 */
export async function getMe(opts: TelegramClientOptions): Promise<{ id: number; username?: string }> {
  return callTelegramApi(opts, "getMe", {});
}

export async function sendChannelMessage(
  opts: TelegramClientOptions,
  channelId: string,
  html: string
): Promise<TelegramSendResult> {
  const result = await callTelegramApi<{ message_id: number }>(opts, "sendMessage", {
    chat_id: channelId,
    text: html,
    parse_mode: "HTML",
  });
  return { messageId: result.message_id };
}

export async function editChannelMessage(
  opts: TelegramClientOptions,
  channelId: string,
  messageId: number,
  html: string
): Promise<void> {
  await callTelegramApi(opts, "editMessageText", {
    chat_id: channelId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
  });
}

export async function deleteChannelMessage(
  opts: TelegramClientOptions,
  channelId: string,
  messageId: number
): Promise<void> {
  await callTelegramApi(opts, "deleteMessage", {
    chat_id: channelId,
    message_id: messageId,
  });
}

/**
 * Verifies the bot can actually post in the configured channel, without
 * sending a visible message — used by the settings/onboarding step for
 * connecting a channel (PROJECT_SPEC.md section 7: "проверка прав бота").
 */
export async function getBotChatMember(
  opts: TelegramClientOptions,
  channelId: string,
  botUserId: number
): Promise<{ status: string; can_post_messages?: boolean }> {
  return callTelegramApi(opts, "getChatMember", {
    chat_id: channelId,
    user_id: botUserId,
  });
}

/**
 * Publishes a rendered video to the channel. Unlike the text methods above,
 * Telegram requires an actual file upload for this (multipart/form-data),
 * not a JSON body, so this bypasses callTelegramApi and builds the request
 * directly. Reads the file into memory — fine for Release 4's MVP duration
 * cap (see packages/video's VIDEO_LIMITS), but would need streaming for
 * much longer videos.
 */
export async function sendChannelVideo(
  opts: TelegramClientOptions,
  channelId: string,
  videoPath: string,
  params: { captionHtml?: string; coverPath?: string } = {}
): Promise<TelegramSendResult> {
  const { readFile } = await import("node:fs/promises");

  const form = new FormData();
  form.append("chat_id", channelId);
  if (params.captionHtml) {
    form.append("caption", params.captionHtml);
    form.append("parse_mode", "HTML");
  }
  form.append("video", new Blob([await readFile(videoPath)]), "video.mp4");
  if (params.coverPath) {
    form.append("thumbnail", new Blob([await readFile(params.coverPath)]), "cover.jpg");
  }
  form.append("supports_streaming", "true");

  const url = buildTelegramUrl(opts.botToken, "sendVideo", opts.apiBaseUrl);

  // Deliberately no Content-Type header here: fetch sets the correct
  // multipart boundary itself when the body is a FormData instance.
  const res = await fetch(url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(3 * 60_000), // video uploads take longer than a JSON call
  });
  const data = (await res.json()) as TelegramApiResponse<{ message_id: number }>;

  if (!data.ok || data.result === undefined) {
    throw new TelegramApiError("sendVideo", data.description ?? "unknown error", data.error_code);
  }
  return { messageId: data.result.message_id };
}
