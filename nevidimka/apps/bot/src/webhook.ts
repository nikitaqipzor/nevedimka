import express from "express";
import { webhookCallback, type Bot, type Context } from "grammy";

export function createWebhookApp<C extends Context>(bot: Bot<C>, secret: string) {
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required for webhook mode");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/telegram/webhook", webhookCallback(bot, "express", { secretToken: secret }));
  return app;
}
