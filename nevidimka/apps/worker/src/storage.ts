import { join } from "node:path";

/**
 * Root directory for everything the worker produces (intermediate work
 * files, preview, cover, final render). Must be the same path — or same
 * mounted volume — that apps/web reads from when serving a preview/cover to
 * the Mini App (see apps/web's VIDEO_STORAGE_ROOT). For a single-machine
 * deployment this is just a shared local directory; for anything more
 * distributed, replace both sides with a real object store and keep this
 * as the local staging area.
 */
const VIDEO_STORAGE_ROOT = process.env.VIDEO_STORAGE_ROOT ?? join(process.cwd(), "storage", "video");

export function workDirFor(videoAssetId: string): string {
  return join(VIDEO_STORAGE_ROOT, videoAssetId, "work");
}

export function outputDirFor(videoAssetId: string): string {
  return join(VIDEO_STORAGE_ROOT, videoAssetId, "output");
}

/** Canonical location for the pre-final "master" (cuts+crop+normalize+subtitles-if-any) file. */
export function masterPathFor(videoAssetId: string): string {
  return join(outputDirFor(videoAssetId), "master.mp4");
}
