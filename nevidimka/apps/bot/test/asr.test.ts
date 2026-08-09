// Tests apps/bot's thin ASR wrapper (services/asr.ts) against a mock
// server, same approach as packages/video/test/asr.test.ts — confirms the
// wrapper correctly delegates and extracts fullText, without needing to
// simulate a full Telegram voice-message download.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("bot's transcribeAudio delegates to the real ASR implementation and returns plain text", async () => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text: "Настроил окружение, репозиторий готов.",
          segments: [{ start: 0, end: 3, text: "Настроил окружение, репозиторий готов." }],
        })
      );
    });
  });
  const url: string = await new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://localhost:${port}`);
    });
  });

  process.env.ASR_API_KEY = "test-key";
  process.env.ASR_API_BASE_URL = url;

  const { transcribeAudio } = await import("../dist/services/asr.js");

  const dir = await mkdtemp(join(tmpdir(), "bot-asr-test-"));
  const audioPath = join(dir, "voice.ogg");
  await writeFile(audioPath, Buffer.from("fake voice audio"));

  const text = await transcribeAudio(audioPath);
  assert.equal(text, "Настроил окружение, репозиторий готов.", "must return plain text (fullText), not the segment array");

  await rm(dir, { recursive: true, force: true });
  await new Promise((r) => server.close(() => r(undefined)));
});

test("bot's transcribeAudio surfaces AsrNotConfiguredError when ASR_API_KEY is unset", async () => {
  delete process.env.ASR_API_KEY;
  const { AsrNotConfiguredError, transcribeAudio } = await import("../dist/services/asr.js");
  await assert.rejects(() => transcribeAudio("/nonexistent.ogg"), AsrNotConfiguredError);
});
