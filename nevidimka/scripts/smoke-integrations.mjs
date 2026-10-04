import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// Opt-in live checks: no webhook changes, messages or channel publications.
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--asr")) throw new Error("Usage: npm run smoke:integrations -- [--asr audio-file]");
  // Compose supplies DB/storage configuration inside containers; this host
  // check only needs provider credentials from .env, not container paths.
  for (const name of ["TELEGRAM_BOT_TOKEN", "ANTHROPIC_API_KEY"]) {
    if (!process.env[name]?.trim() || /placeholder|your-key/i.test(process.env[name])) throw new Error(`${name} must be configured`);
  }
  if (args[0] === "--asr" && !process.env.ASR_API_KEY) throw new Error("ASR_API_KEY is required for --asr");
  const audio = args[0] === "--asr" ? await readFile(args[1]) : undefined;
  const botApi = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const me = await jsonRequest(`${botApi}/getMe`);
  if (!me.ok || !me.result?.is_bot) throw new Error("Telegram token is not a bot token");
  const info = await jsonRequest(`${botApi}/getWebhookInfo`);
  if (!info.ok || info.result.url !== (process.env.TELEGRAM_WEBHOOK_URL?.trim() ?? "")) {
    throw new Error("Telegram webhook configuration differs from environment; start bot and retry");
  }
  if (info.result.last_error_date && info.result.pending_update_count > 0) throw new Error("Telegram webhook has undelivered updates and a delivery error");
  console.log("Telegram: bot token and webhook mode verified");
  await jsonRequest("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.AI_MODEL ?? "claude-sonnet-5", max_tokens: 16, messages: [{ role: "user", content: "Reply with OK." }] }),
  });
  console.log("Anthropic: actual model request verified (billable)");
  if (args[0] === "--asr") {
    if (!process.env.ASR_API_KEY) throw new Error("ASR_API_KEY is required for --asr");
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([audio]), basename(args[1]));
    const result = await jsonRequest("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${process.env.ASR_API_KEY}` }, body: form });
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("ASR returned no transcript");
    console.log("ASR: actual audio transcription verified (billable; transcript not printed)");
  } else console.log("ASR: skipped; supply --asr audio-file to verify optional provider");
}
main().catch(error => {
  // Do not print fetch errors, URLs, response bodies or request credentials.
  console.error(error instanceof TypeError ? "Integration check failed: network/request error" : error.message);
  process.exitCode = 1;
});
