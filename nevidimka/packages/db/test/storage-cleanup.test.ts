import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deleteLocalStorageEntries,
  deleteLocalStorageFiles,
} from "../dist/storageCleanup.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("deletes only user files inside configured storage roots", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "nevidimka-storage-cleanup-"));
  const evidenceRoot = join(tempRoot, "evidence");
  const videoRoot = join(tempRoot, "video");
  const evidenceFile = join(evidenceRoot, "voice.ogg");
  const videoFile = join(videoRoot, "asset", "preview.mp4");

  try {
    await mkdir(join(videoRoot, "asset"), { recursive: true });
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(evidenceFile, "voice");
    await writeFile(videoFile, "video");

    await deleteLocalStorageFiles(
      [evidenceFile, videoFile, evidenceFile, join(videoRoot, "already-missing.mp4")],
      { evidence: evidenceRoot, video: videoRoot }
    );

    assert.equal(await exists(evidenceFile), false);
    assert.equal(await exists(videoFile), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects an outside path before deleting any valid file", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "nevidimka-storage-guard-"));
  const evidenceRoot = join(tempRoot, "evidence");
  const videoRoot = join(tempRoot, "video");
  const insideFile = join(evidenceRoot, "inside.ogg");
  const outsideFile = join(tempRoot, "outside.txt");

  try {
    await mkdir(evidenceRoot, { recursive: true });
    await mkdir(videoRoot, { recursive: true });
    await writeFile(insideFile, "inside");
    await writeFile(outsideFile, "outside");

    await assert.rejects(
      () =>
        deleteLocalStorageFiles([insideFile, outsideFile], {
          evidence: evidenceRoot,
          video: videoRoot,
        }),
      /outside configured storage roots/
    );

    assert.equal(await exists(insideFile), true);
    assert.equal(await exists(outsideFile), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("removes video asset directories recursively", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "nevidimka-storage-directories-"));
  const evidenceRoot = join(tempRoot, "evidence");
  const videoRoot = join(tempRoot, "video");
  const assetDirectory = join(videoRoot, "asset-id");

  try {
    await mkdir(join(assetDirectory, "work"), { recursive: true });
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(join(assetDirectory, "work", "master.mp4"), "video");

    await deleteLocalStorageEntries(
      { files: [], directories: [assetDirectory] },
      { evidence: evidenceRoot, video: videoRoot }
    );

    assert.equal(await exists(assetDirectory), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects paths that escape through a symlinked directory", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "nevidimka-storage-symlink-"));
  const evidenceRoot = join(tempRoot, "evidence");
  const videoRoot = join(tempRoot, "video");
  const outsideDirectory = join(tempRoot, "outside");
  const outsideFile = join(outsideDirectory, "private.txt");
  const linkedDirectory = join(evidenceRoot, "linked");

  try {
    await mkdir(evidenceRoot, { recursive: true });
    await mkdir(videoRoot, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(outsideFile, "private");
    await symlink(outsideDirectory, linkedDirectory, "junction");

    await assert.rejects(
      () =>
        deleteLocalStorageFiles([join(linkedDirectory, "private.txt")], {
          evidence: evidenceRoot,
          video: videoRoot,
        }),
      /outside configured storage roots/
    );
    assert.equal(await exists(outsideFile), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
