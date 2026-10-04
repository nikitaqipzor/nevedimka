import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeEnvironment, isOwnerTelegramId } from "../dist/runtimeConfig.js";

const valid = {
  NODE_ENV: "production", OWNER_TELEGRAM_ID: "700111222",
  DATABASE_URL: "postgres://app@localhost/app", SYSTEM_DATABASE_URL: "postgres://system@localhost/app",
  TELEGRAM_BOT_TOKEN: "123456:configured-test-token", ANTHROPIC_API_KEY: "configured-test-key",
  JWT_SECRET: "0123456789abcdef0123456789abcdef", APP_BASE_URL: "https://app.test",
  VIDEO_STORAGE_ROOT: "/storage/video", EVIDENCE_STORAGE_ROOT: "/storage/evidence",
};

test("production validates every service and polling does not require webhook settings", () => {
  for (const service of ["web", "bot", "worker"]) assert.doesNotThrow(() => validateRuntimeEnvironment(service, valid));
});
test("missing owner fails closed and cannot open production registration", () => {
  assert.throws(() => validateRuntimeEnvironment("web", { ...valid, OWNER_TELEGRAM_ID: "" }), /OWNER_TELEGRAM_ID/);
  assert.equal(isOwnerTelegramId("700111222", { NODE_ENV: "production" }), false);
  assert.equal(isOwnerTelegramId("700111222", valid), true);
  assert.equal(isOwnerTelegramId("700111223", valid), false);
});
test("weak JWT, insecure web URL, dev auth and provider overrides fail before serving", () => {
  for (const changed of [{ JWT_SECRET: "short" }, { APP_BASE_URL: "http://app.test" }, { APP_BASE_URL: "https://your-domain.example.com" }, { ALLOW_DEV_AUTH: "true" }, { ASR_API_BASE_URL: "http://mock" }]) {
    assert.throws(() => validateRuntimeEnvironment("web", { ...valid, ...changed }), /Invalid production/);
  }
});
test("webhook mode requires HTTPS and an unguessable secret", () => {
  const env = { ...valid, TELEGRAM_WEBHOOK_URL: "https://bot.test/telegram/webhook" };
  assert.throws(() => validateRuntimeEnvironment("bot", env), /WEBHOOK_SECRET/);
  assert.doesNotThrow(() => validateRuntimeEnvironment("bot", { ...env, TELEGRAM_WEBHOOK_SECRET: valid.JWT_SECRET }));
  assert.throws(() => validateRuntimeEnvironment("bot", { ...env, TELEGRAM_WEBHOOK_URL: "http://bot.test", TELEGRAM_WEBHOOK_SECRET: valid.JWT_SECRET }), /HTTPS/);
});
test("invalid polling/cost limits are rejected without echoing credentials", () => {
  for (const value of ["NaN", "0", "-1", "1.5"]) assert.throws(() => validateRuntimeEnvironment("worker", { ...valid, WORKER_POLL_INTERVAL_MS: value }), /POLL_INTERVAL/);
  try { validateRuntimeEnvironment("web", { ...valid, JWT_SECRET: "sensitive" }); } catch (err) { assert.ok(!err.message.includes("sensitive")); }
});
