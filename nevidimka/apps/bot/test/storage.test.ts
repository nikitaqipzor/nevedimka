import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { resolveTelegramStorageDirectory } from "../dist/services/storage.js";

test("routes evidence and video uploads to their configured storage roots", () => {
  const cwd = resolve("test-workspace");
  const env = {
    EVIDENCE_STORAGE_ROOT: resolve("custom-evidence"),
    VIDEO_STORAGE_ROOT: resolve("custom-video"),
  };

  assert.equal(resolveTelegramStorageDirectory("evidence", env, cwd), env.EVIDENCE_STORAGE_ROOT);
  assert.equal(
    resolveTelegramStorageDirectory("video", env, cwd),
    resolve(env.VIDEO_STORAGE_ROOT, "uploads")
  );
});

test("uses workspace-local defaults when storage roots are unset", () => {
  const cwd = resolve("test-workspace");

  assert.equal(
    resolveTelegramStorageDirectory("evidence", {}, cwd),
    resolve(cwd, "apps", "bot", "storage", "evidence")
  );
  assert.equal(
    resolveTelegramStorageDirectory("video", {}, cwd),
    resolve(cwd, "storage", "video", "uploads")
  );
});
