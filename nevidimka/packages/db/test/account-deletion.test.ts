import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AccountDeletionBlockedError,
  assertAccountDeletionCanProceed,
} from "../dist/accountDeletion.js";

test("allows account deletion when no video worker is active", () => {
  assert.doesNotThrow(() =>
    assertAccountDeletionCanProceed(["uploaded", "preview_ready", "confirmed", "published", "failed"])
  );
});

test("blocks account deletion while a video worker can still write files", () => {
  assert.throws(
    () => assertAccountDeletionCanProceed(["preview_ready", "processing"]),
    AccountDeletionBlockedError
  );
  assert.throws(
    () => assertAccountDeletionCanProceed(["rendering"]),
    /video processing is active/
  );
});
