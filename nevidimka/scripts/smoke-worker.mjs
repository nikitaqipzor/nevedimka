import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { validateRuntimeEnvironment } from "@nevidimka/shared-types";
import * as db from "@nevidimka/db";
import { processUploadedAsset } from "./apps/worker/dist/jobs.js";
validateRuntimeEnvironment("worker");
assert.equal(typeof processUploadedAsset, "function");
try {
  await db.verifyDatabaseRoles();
  const state = JSON.parse(await readFile(join(process.env.VIDEO_STORAGE_ROOT, "smoke-state.json"), "utf8"));
  await access(state.original); await access(join(state.work, "master.mp4"));
  assert.match(execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }), /ffmpeg version/);
  assert.match(execFileSync("ffprobe", ["-version"], { encoding: "utf8" }), /ffprobe version/);
} finally { await db.closePool(); }
