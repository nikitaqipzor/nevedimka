// Tests for how a failed screen load is classified (lib/useLoad.ts). No
// database and no browser needed — classifyLoadError is a pure function.
//
// Regression context: every screen used to call apiFetch inside a bare
// `useEffect(() => { load() }, [])` with no catch. Any failure left the
// promise rejected unhandled and the data state null, so the screen showed
// "Загрузка…" forever, with no message and no retry. Offline made that the
// NORMAL outcome — precisely the case a PWA exists to handle. These tests
// pin down the distinction the fix introduced: a server that answered with
// an error is not the same event as no network at all, and the user needs
// different words for each.
//
// Run: npx tsx --test test/load-state.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/apiClient.js";
import { classifyLoadError } from "../src/lib/useLoad.js";

test("an ApiError is an error, never offline — the server did answer", () => {
  const result = classifyLoadError(new ApiError("Черновик не готов", 422), true);

  assert.equal(result.state, "error");
  assert.equal(result.error, "Черновик не готов", "the server's own message is shown as-is");
});

test("an ApiError stays an error even when the browser reports being offline", () => {
  // The response already came back, so onLine is irrelevant here. Reporting
  // "нет сети" would hide a real server-side problem behind a wrong cause.
  const result = classifyLoadError(new ApiError("Слишком много обращений к AI", 429), false);

  assert.equal(result.state, "error");
  assert.equal(result.error, "Слишком много обращений к AI");
});

test("a fetch-layer TypeError while offline is reported as offline", () => {
  const result = classifyLoadError(new TypeError("Failed to fetch"), false);

  assert.equal(result.state, "offline");
  assert.equal(result.error, "Нет сети.");
});

test("a fetch-layer failure while nominally online is a generic error", () => {
  // navigator.onLine reports link state, not reachability: it is true on a
  // captive-portal wifi or with a dead uplink. So this path must not claim
  // "нет сети" — it says something went wrong without guessing the cause.
  const result = classifyLoadError(new TypeError("Failed to fetch"), true);

  assert.equal(result.state, "error");
  assert.equal(result.error, "Не удалось загрузить данные.");
});

test("never returns 'loading' or 'ready' — it only classifies failures", () => {
  for (const [err, online] of [
    [new ApiError("x", 500), true],
    [new TypeError("Failed to fetch"), false],
    [new Error("something odd"), true],
    ["a thrown string", false],
  ] as const) {
    const { state } = classifyLoadError(err, online);
    assert.ok(
      state === "error" || state === "offline",
      `expected a failure state, got "${state}"`
    );
  }
});

test("a non-Error throw is still classified rather than crashing the handler", () => {
  // Anything can be thrown in JS; the catch block must not itself throw.
  const result = classifyLoadError("unexpected string", true);

  assert.equal(result.state, "error");
  assert.equal(result.error, "Не удалось загрузить данные.");
});

test("an offline classification always carries a message the screen can render", () => {
  const result = classifyLoadError(new TypeError("Failed to fetch"), false);

  assert.ok(result.error.length > 0, "an empty message would render a blank error box");
});
