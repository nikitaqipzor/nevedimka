import { join } from "node:path";

/**
 * Must point at the same directory apps/worker writes to
 * (VIDEO_STORAGE_ROOT) — see that package's storage.ts for the full
 * rationale. For a single-machine deployment this is just a shared local
 * path; both processes need the same env var value.
 */
const VIDEO_STORAGE_ROOT = process.env.VIDEO_STORAGE_ROOT ?? join(process.cwd(), "storage", "video");

export function outputDirFor(videoAssetId: string): string {
  return join(VIDEO_STORAGE_ROOT, videoAssetId, "output");
}
