// Regression tests for the video job queue's claim/retry semantics.
//
// Two confirmed defects motivated these:
//   1. The worker used to poll with a plain `select ... where status = $1`
//      and only transition the status later, inside the job handler. Between
//      those two steps the row still looked queued, so two workers (or one
//      worker whose tick overlapped its own slow job) could both claim the
//      same asset — running the ffmpeg pipeline twice and, for 'confirmed'
//      assets, publishing to the channel twice.
//   2. recoverStaleVideoJobs requeued stuck jobs with no attempt limit, so a
//      job that killed the worker *process* (OOM, container restart) looped
//      forever, re-paying for ASR transcription every cycle.
//
// Run: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/video-queue.test.ts
// (DATABASE_URL must be a superuser connection — this creates a throwaway db.)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_video_queue_test";

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

let db: typeof import("../dist/index.js");
let userId: string;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const migrationsDir = join(import.meta.dirname, "..", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const dbAdmin = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  await dbAdmin.connect();
  for (const file of files) {
    await dbAdmin.query(readFileSync(join(migrationsDir, file), "utf8"));
  }
  await dbAdmin.end();

  process.env.DATABASE_URL = urlForDb(TEST_DB);
  db = await import("../dist/index.js");
  const user = await db.getOrCreateUser({ telegramId: "video-queue-test" });
  userId = user.id;
});

after(async () => {
  await db.closePool();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.end();
});

async function newAsset(status: "uploaded" | "confirmed" = "uploaded"): Promise<string> {
  const asset = await db.createVideoAsset({
    userId,
    originalStoragePath: `/tmp/video-queue-test-${Date.now()}-${Math.random()}.mp4`,
  });
  if (status !== "uploaded") {
    await db.updateVideoAssetStatus(userId, asset.id, status);
  }
  return asset.id;
}

/** Forces a job to look stale by backdating updated_at. */
async function makeStale(assetId: string, minutes: number): Promise<void> {
  const pool = db.getPool();
  await pool.query(
    `update video_assets set updated_at = now() - ($2 || ' minutes')::interval where id = $1`,
    [assetId, minutes]
  );
}

test("claiming transitions the asset out of the queued status atomically", async () => {
  const id = await newAsset("uploaded");

  const claimed = await db.claimVideoAssetsForProcessing("uploaded");
  const mine = claimed.find((a) => a.id === id);

  assert.ok(mine, "the queued asset must be claimed");
  assert.equal(mine!.status, "processing", "claim must move it out of 'uploaded' itself");
  assert.equal(mine!.attempts, 1, "claim must count as an attempt");
});

test("a second claim cannot pick up an already-claimed asset", async () => {
  const id = await newAsset("uploaded");

  const first = await db.claimVideoAssetsForProcessing("uploaded");
  assert.ok(first.some((a) => a.id === id), "first claim should get it");

  // This is the double-processing bug: with the old plain SELECT both calls
  // returned the same row.
  const second = await db.claimVideoAssetsForProcessing("uploaded");
  assert.ok(
    !second.some((a) => a.id === id),
    "a claimed asset must not be handed out twice"
  );
});

test("confirmed assets claim into 'rendering', not 'processing'", async () => {
  const id = await newAsset("confirmed");
  const claimed = await db.claimVideoAssetsForProcessing("confirmed");
  const mine = claimed.find((a) => a.id === id);

  assert.ok(mine, "confirmed asset must be claimable");
  assert.equal(mine!.status, "rendering");
});

test("a stale job under the attempt limit is requeued with a backoff, not immediately claimable", async () => {
  const id = await newAsset("uploaded");
  await db.claimVideoAssetsForProcessing("uploaded"); // attempts -> 1, status 'processing'
  await makeStale(id, 30);

  const { requeued, deadLettered } = await db.recoverStaleVideoJobs(15, 3);
  assert.ok(requeued >= 1, "stale job must be requeued");
  assert.equal(deadLettered, 0, "not out of attempts yet");

  const after = await db.getVideoAsset(userId, id);
  assert.equal(after?.status, "uploaded", "requeue returns it to the queued status");
  assert.ok(after?.nextRetryAt, "requeue must set a backoff deadline");

  // The backoff is the point: it must NOT be claimable again right away,
  // which is what turned a worker-killing job into a hot loop.
  const claimed = await db.claimVideoAssetsForProcessing("uploaded");
  assert.ok(
    !claimed.some((a) => a.id === id),
    "a job inside its backoff window must not be claimed yet"
  );
});

test("a stale job that exhausted its attempts is dead-lettered instead of looping forever", async () => {
  const id = await newAsset("uploaded");

  // Burn through the attempt budget the way a worker-killing job would:
  // claimed, never completed, recovered, claimed again...
  for (let i = 0; i < 3; i++) {
    const pool = db.getPool();
    await pool.query(`update video_assets set next_retry_at = null where id = $1`, [id]);
    const claimed = await db.claimVideoAssetsForProcessing("uploaded");
    assert.ok(claimed.some((a) => a.id === id), `attempt ${i + 1} should claim`);
    await makeStale(id, 30);
    await db.recoverStaleVideoJobs(15, 3);
  }

  const after = await db.getVideoAsset(userId, id);
  assert.equal(after?.status, "failed", "must end up dead-lettered, not requeued again");
  assert.ok(
    after!.attempts >= 3,
    `attempts must be preserved across requeues, got ${after!.attempts}`
  );
  assert.match(
    after?.errorMessage ?? "",
    /снята с очереди/,
    "the error must say the job was given up on, so a human can see it"
  );

  // Terminal means terminal: further recovery passes must not resurrect it.
  await makeStale(id, 60);
  const { requeued } = await db.recoverStaleVideoJobs(15, 3);
  const stillFailed = await db.getVideoAsset(userId, id);
  assert.equal(stillFailed?.status, "failed");
  assert.ok(
    !(await db.claimVideoAssetsForProcessing("uploaded")).some((a) => a.id === id),
    "a dead-lettered job must never be claimed again"
  );
  void requeued;
});

test("reaching a waiting/terminal state clears the retry backoff", async () => {
  const id = await newAsset("uploaded");
  await db.claimVideoAssetsForProcessing("uploaded");
  await makeStale(id, 30);
  await db.recoverStaleVideoJobs(15, 3);

  const backedOff = await db.getVideoAsset(userId, id);
  assert.ok(backedOff?.nextRetryAt, "precondition: a backoff is pending");

  // A successful run reaching preview_ready must not leave the old backoff
  // behind, or the user's later confirmation would sit unclaimed.
  await db.updateVideoAssetStatus(userId, id, "preview_ready");
  const cleared = await db.getVideoAsset(userId, id);
  assert.equal(cleared?.nextRetryAt, undefined, "backoff must be cleared");

  await db.updateVideoAssetStatus(userId, id, "confirmed");
  const claimed = await db.claimVideoAssetsForProcessing("confirmed");
  assert.ok(
    claimed.some((a) => a.id === id),
    "a confirmed asset must be claimable immediately after the user confirms"
  );
});
