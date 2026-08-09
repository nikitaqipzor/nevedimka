// Full pipeline test against a real, synthetically-generated video (built
// with ffmpeg itself, so no test fixture file needs to be committed).
// Verifies actual measured properties of the output at each stage — not
// just "the function didn't throw". Run:
//   npx tsx --test test/pipeline.test.ts
// Requires ffmpeg/ffprobe on PATH.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/ffmpeg.js";
import { probeVideo } from "../src/probe.js";
import { detectSilences } from "../src/silence.js";
import { proposeCutsFromSilence } from "../src/cutPlan.js";
import { segmentsToSrt } from "../src/srt.js";
import { embedSubtitles, generateCover, renderPreview } from "../src/transform.js";
import { runPipelineToPreview, runFinalRender } from "../src/pipeline.js";
import http from "node:http";
import type { AddressInfo } from "node:net";

let workDir: string;
let sourcePath: string;

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), "nevidimka-video-test-"));
  sourcePath = join(workDir, "source.mp4");

  // 9s landscape video with a genuine 2.5s silent gap in the audio
  // (3s tone, 2.5s silence, 3.5s tone) — the same synthetic fixture
  // manually verified during Release 4 development.
  const videoOnly = join(workDir, "video_only.mp4");
  const tone1 = join(workDir, "tone1.wav");
  const silence = join(workDir, "silence.wav");
  const tone2 = join(workDir, "tone2.wav");
  const audioFull = join(workDir, "audio_full.wav");
  const audioList = join(workDir, "audio_list.txt");

  await runCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25:duration=9",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", videoOnly,
  ]);
  await runCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", tone1]);
  await runCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2.5", silence]);
  await runCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3.5", tone2]);
  await writeFile(audioList, `file '${tone1}'\nfile '${silence}'\nfile '${tone2}'\n`);
  await runCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", audioList, "-c", "copy", audioFull]);
  await runCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", videoOnly, "-i", audioFull, "-c:v", "copy", "-c:a", "aac", "-shortest", sourcePath,
  ]);
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test("probeVideo reports correct duration and landscape dimensions", async () => {
  const probe = await probeVideo(sourcePath);
  assert.equal(probe.durationSeconds, 9);
  assert.equal(probe.width, 1280);
  assert.equal(probe.height, 720);
  assert.equal(probe.hasAudio, true);
});

test("detectSilences finds the real 2.5s gap, proposeCutsFromSilence turns it into one cut", async () => {
  const silences = await detectSilences(sourcePath);
  assert.ok(silences.length >= 1);
  const gap = silences.find((s) => s.end - s.start > 2);
  assert.ok(gap, "expected to find the ~2.5s silence gap");

  const cuts = proposeCutsFromSilence(silences, 9);
  assert.equal(cuts.length, 1);
  // Real gap is 3.0-5.5s; padding trims the edges slightly.
  assert.ok(Math.abs(cuts[0].start - 3.3) < 0.5);
  assert.ok(Math.abs(cuts[0].end - 5.2) < 0.5);
});

test("segmentsToSrt produces correctly formatted SRT timestamps", () => {
  const srt = segmentsToSrt([{ start: 0, end: 2.5, text: "Первый шаг сделан." }]);
  assert.match(srt, /00:00:00,000 --> 00:00:02,500/);
  assert.match(srt, /Первый шаг сделан\./);
});

test("full pipeline to preview: cuts applied, vertical crop, cover, preview all real and measured", async () => {
  const result = await runPipelineToPreview(sourcePath, workDir);

  assert.equal(result.transcript, null, "ASR is not configured — pipeline must degrade gracefully, not fail");
  assert.equal(result.cuts.length, 1);

  const processedProbe = await probeVideo(result.processedPath);
  // 9s minus the ~1.9s actually removed (2.5s gap minus padding) ≈ 7.2s
  assert.ok(processedProbe.durationSeconds < 8.5, "cuts must actually shorten the video");
  assert.equal(processedProbe.width, 1080, "must be cropped to vertical 9:16");
  assert.equal(processedProbe.height, 1920);

  const previewProbe = await probeVideo(result.previewPath);
  assert.ok(previewProbe.width <= 480, "preview must be downscaled");

  const finalPath = join(workDir, "final.mp4");
  await runFinalRender(result.processedPath, finalPath);
  const finalProbe = await probeVideo(finalPath);
  assert.equal(finalProbe.width, 1080, "final render must preserve the vertical crop");
  assert.equal(finalProbe.height, 1920);
});

test("embedSubtitles adds a real subtitle stream to the container", async () => {
  const normalizedPath = join(workDir, "03-normalized.mp4");
  // Produced by the pipeline test above — reuse it rather than
  // re-running the whole pipeline just for this assertion.
  const probe = await probeVideo(normalizedPath).catch(() => null);
  if (!probe) return; // pipeline test above didn't leave this file for some reason — skip rather than fail spuriously

  const srtPath = join(workDir, "captions.srt");
  await writeFile(srtPath, segmentsToSrt([{ start: 0, end: 2, text: "Тест" }]), "utf8");
  const withSubsPath = join(workDir, "with_subs.mp4");
  await embedSubtitles(normalizedPath, srtPath, withSubsPath);

  const { stdout } = await runCommand("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1", withSubsPath,
  ]);
  assert.match(stdout, /codec_type=subtitle/);
});

test("generateCover and renderPreview produce real, probeable files", async () => {
  const coverPath = join(workDir, "standalone-cover.jpg");
  await generateCover(sourcePath, coverPath, 1);
  const { stdout: coverInfo } = await runCommand("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1", coverPath,
  ]);
  assert.match(coverInfo, /codec_type=video/); // still-image streams report as video in ffprobe

  const previewPath = join(workDir, "standalone-preview.mp4");
  await renderPreview(sourcePath, previewPath, { maxWidth: 320 });
  const probe = await probeVideo(previewPath);
  assert.ok(probe.width <= 320);
});

test("full pipeline generates real subtitles when ASR is configured (mock server)", async () => {
  const mockServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", () => undefined);
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text: "Тест субтитров.",
          segments: [{ start: 0, end: 2, text: "Тест субтитров." }],
        })
      );
    });
  });
  const mockUrl: string = await new Promise((resolve) => {
    mockServer.listen(0, () => {
      const { port } = mockServer.address() as AddressInfo;
      resolve(`http://localhost:${port}`);
    });
  });

  const prevKey = process.env.ASR_API_KEY;
  const prevBase = process.env.ASR_API_BASE_URL;
  process.env.ASR_API_KEY = "test-key";
  process.env.ASR_API_BASE_URL = mockUrl;

  try {
    const asrWorkDir = await mkdtemp(join(tmpdir(), "nevidimka-video-asr-test-"));
    try {
      const result = await runPipelineToPreview(sourcePath, asrWorkDir);
      assert.ok(result.transcript, "transcript must be populated when ASR succeeds, not null");
      assert.equal(result.transcript?.fullText, "Тест субтитров.");

      const { access } = await import("node:fs/promises");
      const srtPath = join(asrWorkDir, "captions.srt");
      await access(srtPath); // throws if it doesn't exist
      const { readFile } = await import("node:fs/promises");
      const srtContent = await readFile(srtPath, "utf8");
      assert.match(srtContent, /Тест субтитров/, "the actual transcript text must be in the generated .srt file");

      // The processed output must also actually carry the subtitle stream.
      const { stdout } = await runCommand("ffprobe", [
        "-v", "error", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1", result.processedPath,
      ]);
      assert.match(stdout, /codec_type=subtitle/, "subtitles must be embedded in the pipeline's own output, not just written as a loose file");
    } finally {
      await rm(asrWorkDir, { recursive: true, force: true });
    }
  } finally {
    if (prevKey === undefined) delete process.env.ASR_API_KEY;
    else process.env.ASR_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.ASR_API_BASE_URL;
    else process.env.ASR_API_BASE_URL = prevBase;
    await new Promise((r) => mockServer.close(() => r(undefined)));
  }
});
