import "dotenv/config";
import { listVideoAssetsByStatus, recoverStaleVideoJobs } from "@nevidimka/db";
import { createLogger } from "@nevidimka/logger";
import { processConfirmedAsset, processUploadedAsset } from "./jobs.js";

const log = createLogger("worker");

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const STALE_JOB_MINUTES = Number(process.env.WORKER_STALE_JOB_MINUTES ?? 15);

async function tick(): Promise<void> {
  try {
    const recovered = await recoverStaleVideoJobs(STALE_JOB_MINUTES);
    if (recovered > 0) {
      log.warn(
        { recovered },
        "recovered job(s) stuck in processing/rendering (worker likely crashed or restarted mid-job) — requeued automatically"
      );
    }

    const uploaded = await listVideoAssetsByStatus("uploaded");
    for (const asset of uploaded) {
      log.info({ assetId: asset.id }, "processing upload -> preview");
      await processUploadedAsset(asset);
    }

    const confirmed = await listVideoAssetsByStatus("confirmed");
    for (const asset of confirmed) {
      log.info({ assetId: asset.id }, "processing confirmed -> render+publish");
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
