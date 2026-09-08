// Tests for the two pure pieces of the AI client: cost estimation and
// response JSON extraction. No API key, no network, no database.
//
// Run: npx tsx --test test/client.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd, parseJsonResponse } from "../src/client.js";

// --- cost estimation ------------------------------------------------------
// This figure is written to ai_logs.cost_usd and is the only record of what
// the system spends. Two rates in the pricing table were silently wrong
// before they were checked against published pricing: claude-sonnet-5 sat at
// the Sonnet-4.6 rate, and claude-opus-4-8 at 15/75 — triple its real 5/25,
// overstating every Opus call threefold. These tests pin the rates to
// published pricing so the next drift shows up as a failure.

test("opus-5 is priced at $5/$25 per million tokens", () => {
  // 1M in + 1M out => 5 + 25
  assert.equal(estimateCostUsd("claude-opus-5", 1_000_000, 1_000_000), 30);
});

test("opus-4-8 is priced at $5/$25 — not the 15/75 it was once listed at", () => {
  assert.equal(estimateCostUsd("claude-opus-4-8", 1_000_000, 1_000_000), 30);
  // Guard the specific old bug: 15/75 would have produced 90.
  assert.notEqual(estimateCostUsd("claude-opus-4-8", 1_000_000, 1_000_000), 90);
});

test("sonnet-5 is priced at $2/$10 — not the Sonnet-4.6 rate it was once given", () => {
  assert.equal(estimateCostUsd("claude-sonnet-5", 1_000_000, 1_000_000), 12);
  // 3/15 would have produced 18.
  assert.notEqual(estimateCostUsd("claude-sonnet-5", 1_000_000, 1_000_000), 18);
});

test("sonnet-4-6 and haiku-4-5 carry their own distinct rates", () => {
  assert.equal(estimateCostUsd("claude-sonnet-4-6", 1_000_000, 1_000_000), 18);
  assert.equal(estimateCostUsd("claude-haiku-4-5", 1_000_000, 1_000_000), 6);
});

test("the dated haiku alias prices identically to the bare id", () => {
  assert.equal(
    estimateCostUsd("claude-haiku-4-5-20251001", 500_000, 200_000),
    estimateCostUsd("claude-haiku-4-5", 500_000, 200_000)
  );
});

test("an unknown model falls back to the cheapest current tier, never inflating", () => {
  const unknown = estimateCostUsd("claude-something-unreleased", 1_000_000, 1_000_000);
  const cheapestKnown = estimateCostUsd("claude-sonnet-5", 1_000_000, 1_000_000);

  assert.equal(unknown, cheapestKnown);
  // The point of the fallback: a model nobody has priced yet must not make
  // cost_usd look larger than it is.
  assert.ok(unknown <= estimateCostUsd("claude-opus-5", 1_000_000, 1_000_000));
});

test("cost scales linearly and input is cheaper than output", () => {
  const half = estimateCostUsd("claude-opus-5", 500_000, 500_000);
  const full = estimateCostUsd("claude-opus-5", 1_000_000, 1_000_000);
  assert.ok(Math.abs(full - half * 2) < 1e-9);

  const inputOnly = estimateCostUsd("claude-opus-5", 1_000_000, 0);
  const outputOnly = estimateCostUsd("claude-opus-5", 0, 1_000_000);
  assert.ok(inputOnly < outputOnly, "output tokens cost more than input tokens");
});

test("a zero-token call costs nothing", () => {
  assert.equal(estimateCostUsd("claude-opus-5", 0, 0), 0);
});

// --- response JSON extraction --------------------------------------------
// Roles are prompted for JSON-only output, but models wrap it in fences or
// add a sentence around it often enough that this has to be tolerant. It
// must NOT be so tolerant that it silently accepts garbage — a wrong parse
// becomes fabricated plan data downstream.

test("parses a bare JSON object", () => {
  assert.deepEqual(parseJsonResponse('{"mainTask":"написать отчёт"}'), {
    mainTask: "написать отчёт",
  });
});

test("strips a ```json fence", () => {
  const raw = '```json\n{"completionPercent": 70}\n```';
  assert.deepEqual(parseJsonResponse(raw), { completionPercent: 70 });
});

test("strips a plain ``` fence with no language tag", () => {
  assert.deepEqual(parseJsonResponse('```\n{"ok":true}\n```'), { ok: true });
});

test("tolerates prose around a fenced block", () => {
  const raw = 'Вот результат:\n```json\n{"flags":[]}\n```\nГотово.';
  assert.deepEqual(parseJsonResponse(raw), { flags: [] });
});

test("extracts a balanced object when there is no fence but there is prose", () => {
  assert.deepEqual(parseJsonResponse('Конечно! {"energy": 4} — вот оценка.'), { energy: 4 });
});

test("parses a top-level array", () => {
  assert.deepEqual(parseJsonResponse('[{"title":"a"},{"title":"b"}]'), [
    { title: "a" },
    { title: "b" },
  ]);
});

test("a brace inside a string does not truncate extraction early", () => {
  // The balanced-region scanner has to respect quotes, or a task title
  // containing a brace would cut the object short.
  const raw = 'Ответ: {"note":"использовать {placeholder} в шаблоне","done":true}';
  assert.deepEqual(parseJsonResponse(raw), {
    note: "использовать {placeholder} в шаблоне",
    done: true,
  });
});

test("an escaped quote inside a string does not end the string early", () => {
  const raw = '{"note":"он сказал \\"да\\"","ok":true}';
  assert.deepEqual(parseJsonResponse(raw), { note: 'он сказал "да"', ok: true });
});

test("throws on text containing no JSON at all", () => {
  assert.throws(
    () => parseJsonResponse("Извините, не могу помочь с этим запросом."),
    /was not valid JSON/,
    "a refusal must surface as an error, not be silently swallowed"
  );
});

test("throws on a truncated object rather than returning partial data", () => {
  // Realistic under a low maxTokens: the model gets cut off mid-object.
  // Returning half a plan would be worse than failing.
  assert.throws(() => parseJsonResponse('{"mainTask":"написать отч'));
});

test("throws on an empty response", () => {
  assert.throws(() => parseJsonResponse(""));
  assert.throws(() => parseJsonResponse("   \n  "));
});
