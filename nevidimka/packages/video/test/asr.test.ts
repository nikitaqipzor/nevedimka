// Tests the ASR integration against a mock server shaped like OpenAI's
// real /v1/audio/transcriptions endpoint. This is the honest limit of
// what could be verified in this codebase's development environment —
// api.openai.com itself was never reachable, so this confirms the
// request is built correctly and the response is parsed correctly, not
// that OpenAI's real API behaves exactly as documented. See asr.ts's doc
// comment for the same caveat.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function startMockOpenAi(responder: (req: http.IncomingMessage, body: Buffer) => { status: number; json: unknown }) {
  const requests: { headers: http.IncomingHttpHeaders; url?: string; bodyLength: number; bodyText: string }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ headers: req.headers, url: req.url, bodyLength: body.length, bodyText: body.toString("utf8") });
      const { status, json } = responder(req, body);
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(json));
    });
  });
  return new Promise<{ url: string; requests: typeof requests; close: () => Promise<void> }>((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://localhost:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test("throws AsrNotConfiguredError when ASR_API_KEY is unset", async () => {
  delete process.env.ASR_API_KEY;
  const { AsrNotConfiguredError, transcribeVideoAudio } = await import("../dist/asr.js");
  await assert.rejects(() => transcribeVideoAudio("/nonexistent.wav"), AsrNotConfiguredError);
});

test("sends a correctly-shaped multipart request and parses segment timestamps from the response", async () => {
  const mock = await startMockOpenAi((req) => ({
    status: 200,
    json: {
      text: "Сегодня настроил CI и написал первый эндпоинт.",
      segments: [
        { start: 0.0, end: 2.4, text: "Сегодня настроил CI" },
        { start: 2.4, end: 5.1, text: "и написал первый эндпоинт." },
      ],
    },
  }));

  const dir = await mkdtemp(join(tmpdir(), "asr-test-"));
  const audioPath = join(dir, "audio.wav");
  await writeFile(audioPath, Buffer.from("fake audio bytes"));

  process.env.ASR_API_KEY = "test-key";
  process.env.ASR_API_BASE_URL = mock.url;
  const { transcribeVideoAudio } = await import("../dist/asr.js");

  const result = await transcribeVideoAudio(audioPath);

  assert.equal(mock.requests.length, 1);
  const req = mock.requests[0];
  assert.equal(req.url, "/v1/audio/transcriptions");
  assert.equal(req.headers.authorization, "Bearer test-key");
  assert.match(req.headers["content-type"] ?? "", /multipart\/form-data/);
  assert.ok(req.bodyLength > 0, "the audio file bytes must actually be in the request body");
  assert.match(req.bodyText, /whisper-1/, "model=whisper-1 must be in the form data");
  assert.match(req.bodyText, /verbose_json/, "response_format=verbose_json must be requested (needed for segment timestamps)");

  assert.equal(result.fullText, "Сегодня настроил CI и написал первый эндпоинт.");
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments[0], { start: 0, end: 2.4, text: "Сегодня настроил CI" });

  await mock.close();
  await rm(dir, { recursive: true, force: true });
});

test("a non-2xx response is surfaced as a real error, not swallowed", async () => {
  const mock = await startMockOpenAi(() => ({ status: 401, json: { error: { message: "Invalid API key" } } }));

  const dir = await mkdtemp(join(tmpdir(), "asr-test-"));
  const audioPath = join(dir, "audio.wav");
  await writeFile(audioPath, Buffer.from("fake"));

  process.env.ASR_API_KEY = "bad-key";
  process.env.ASR_API_BASE_URL = mock.url;
  const { transcribeVideoAudio } = await import("../dist/asr.js");

  await assert.rejects(() => transcribeVideoAudio(audioPath), /401/);

  await mock.close();
  await rm(dir, { recursive: true, force: true });
});

test("a response with no segments (some providers omit them) still returns a usable transcript", async () => {
  const mock = await startMockOpenAi(() => ({ status: 200, json: { text: "Только текст, без таймкодов." } }));

  const dir = await mkdtemp(join(tmpdir(), "asr-test-"));
  const audioPath = join(dir, "audio.wav");
  await writeFile(audioPath, Buffer.from("fake"));

  process.env.ASR_API_KEY = "test-key";
  process.env.ASR_API_BASE_URL = mock.url;
  const { transcribeVideoAudio } = await import("../dist/asr.js");

  const result = await transcribeVideoAudio(audioPath);
  assert.equal(result.fullText, "Только текст, без таймкодов.");
  assert.deepEqual(result.segments, []);

  await mock.close();
  await rm(dir, { recursive: true, force: true });
});
