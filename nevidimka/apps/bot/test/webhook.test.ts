import { test } from "node:test";
import assert from "node:assert/strict";
import { Bot } from "grammy";
import { createWebhookApp } from "../dist/webhook.js";

test("webhook rejects absent/wrong secrets and accepts an authenticated update", { timeout: 10000 }, async () => {
  const bot = new Bot("123456:test-token");
  bot.botInfo = { id: 123456, is_bot: true, first_name: "Test", username: "test_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as typeof bot.botInfo;
  let received = 0;
  bot.on("message", () => { received++; });
  const secret = "webhook-test-secret-0123456789abcdef";
  assert.throws(() => createWebhookApp(bot, ""), /SECRET/);
  const server = createWebhookApp(bot, secret).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    for (const supplied of ["", "wrong", secret]) {
      const res = await fetch(`${base}/telegram/webhook`, {
        method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": supplied },
        body: JSON.stringify({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1, type: "private" }, text: "hello" } }),
      });
      assert.equal(res.status, supplied === secret ? 200 : 401);
    }
    assert.equal(received, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
