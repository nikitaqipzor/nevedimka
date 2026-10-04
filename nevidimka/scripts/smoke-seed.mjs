import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateRuntimeEnvironment } from "@nevidimka/shared-types";
import { createLogger } from "@nevidimka/logger";
import * as db from "@nevidimka/db";
import { createBot } from "./apps/bot/dist/bot.js";
validateRuntimeEnvironment("bot");
assert.ok(createLogger("smoke"));
assert.ok(createBot(process.env.TELEGRAM_BOT_TOKEN));
try {
  await db.verifyDatabaseRoles();
  const user = await db.getOrCreateUser({ telegramId: process.env.OWNER_TELEGRAM_ID });
  const other = await db.getOrCreateUser({ telegramId: "700111223" });
  const evidence = join(process.env.EVIDENCE_STORAGE_ROOT, "smoke-private.txt");
  const original = join(process.env.VIDEO_STORAGE_ROOT, "uploads", "smoke-original.mp4");
  await mkdir(process.env.EVIDENCE_STORAGE_ROOT, { recursive: true });
  await mkdir(join(process.env.VIDEO_STORAGE_ROOT, "uploads"), { recursive: true });
  await writeFile(evidence, "private"); await writeFile(original, "original");
  await writeFile(join(process.env.VIDEO_STORAGE_ROOT, "other-user.txt"), "keep");
  await db.addEvidence({ userId: user.id, kind: "voice", storagePath: evidence });
  const asset = await db.createVideoAsset({ userId: user.id, originalStoragePath: original });
  const work = join(process.env.VIDEO_STORAGE_ROOT, asset.id, "work");
  await mkdir(work, { recursive: true }); await writeFile(join(work, "master.mp4"), "work");
  await writeFile(join(process.env.VIDEO_STORAGE_ROOT, "smoke-state.json"), JSON.stringify({ userId: user.id, otherId: other.id, assetId: asset.id, evidence, original, work }));
} finally { await db.closePool(); }
