import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { webhookCallback } from "grammy";
import { createLogger } from "@nevidimka/logger";
import { createBot, registerBotCommands } from "./bot.js";
import { runMorningReminderJob } from "./jobs/morning.js";
import { runEveningReminderJob } from "./jobs/evening.js";

const log = createLogger("bot");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set");
}

const bot = createBot(token);

// Hourly reminder jobs (PROJECT_SPEC.md sections 4.2 / 4.4). Each job calls
// listUsersForReminder() itself and evaluates "is it this user's local
// reminder hour right now" in SQL, so one hourly tick correctly serves
// users across every timezone without per-user scheduling.
cron.schedule("0 * * * *", () => {
  runMorningReminderJob(bot).catch((err) => log.error({ err }, "morning reminder job failed"));
});
cron.schedule("0 * * * *", () => {
  runEveningReminderJob(bot).catch((err) => log.error({ err }, "evening reminder job failed"));
});

const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  await registerBotCommands(bot);

  if (webhookUrl && !webhookUrl.includes("your-domain.example.com")) {
    // Production mode: Telegram pushes updates to us over HTTPS.
    const app = express();
    app.use(express.json());
    app.get("/health", (_req, res) => res.json({ ok: true }));
    app.post(
      "/telegram/webhook",
      webhookCallback(bot, "express", {
        secretToken: webhookSecret,
      })
    );

    await bot.api.setWebhook(webhookUrl, webhookSecret ? { secret_token: webhookSecret } : undefined);
    app.listen(port, () => {
      log.info({ port, webhookUrl }, "bot listening (webhook mode)");
    });
  } else {
    // Local dev fallback: long polling, no public URL required.
    await bot.api.deleteWebhook().catch(() => undefined);
    log.info(
      "bot starting in long-polling mode (set TELEGRAM_WEBHOOK_URL to a real HTTPS URL for production webhook mode)"
    );
    await bot.start();
  }
}

main().catch((err) => {
  log.fatal({ err }, "fatal error starting bot");
  process.exit(1);
});
