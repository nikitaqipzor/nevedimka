import "dotenv/config";
import { claimVideoAssetsForProcessing, recoverStaleVideoJobs } from "@nevidimka/db";
import { createLogger } from "@nevidimka/logger";
import { processConfirmedAsset, processUploadedAsset } from "./jobs.js";

const log = createLogger("worker");

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const STALE_JOB_MINUTES = Number(process.env.WORKER_STALE_JOB_MINUTES ?? 15);
/**
 * How many times a video job may be claimed before it is dead-lettered
 * (marked 'failed' and left alone). Bounds the requeue loop in
 * recoverStaleVideoJobs — see migration 011 for the failure this prevents.
 */
const MAX_JOB_ATTEMPTS = Number(process.env.WORKER_MAX_JOB_ATTEMPTS ?? 3);

async function tick(): Promise<void> {
  try {
    const { requeued, deadLettered } = await recoverStaleVideoJobs(
      STALE_JOB_MINUTES,
      MAX_JOB_ATTEMPTS
    );
    if (requeued > 0) {
      log.warn(
        { requeued },
        "recovered job(s) stuck in processing/rendering (worker likely crashed or restarted mid-job) — requeued with backoff"
      );
    }
    if (deadLettered > 0) {
      // Deliberately louder than a requeue: this is a job giving up for
      // good, and the only signal that something is un-processable rather
      // than merely unlucky.
      log.error(
        { deadLettered, maxAttempts: MAX_JOB_ATTEMPTS },
        "job(s) exhausted their retry budget and were marked failed — needs a human look"
      );
    }

    // Claiming already moves these to 'processing'/'rendering', so the
    // handlers below receive assets that no other worker can pick up.
    const uploaded = await claimVideoAssetsForProcessing("uploaded");
    for (const asset of uploaded) {
      log.info({ assetId: asset.id, attempt: asset.attempts }, "processing upload -> preview");
      await processUploadedAsset(asset);
    }

    const confirmed = await claimVideoAssetsForProcessing("confirmed");
    for (const asset of confirmed) {
      log.info({ assetId: asset.id, attempt: asset.attempts }, "processing confirmed -> render+publish");
      await processConfirmedAsset(asset);
    }
  } catch (err) {
    log.error({ err }, "poll tick failed");
  }
}

async function main(): Promise<void> {
  log.info({ pollIntervalMs: POLL_INTERVAL_MS }, "video worker started");
  // Sequential polling loop (not setInterval): guarantees the next poll
  // never overlaps a still-running ffmpeg job, which matters since a
  // single video's pipeline can easily take longer than the poll interval.
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  log.fatal({ err }, "fatal error in worker");
  process.exit(1);
});
