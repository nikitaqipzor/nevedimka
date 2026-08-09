import { unlink } from "node:fs/promises";
import { runFfmpeg } from "./ffmpeg.js";
import { probeVideo } from "./probe.js";
import type { VideoCut } from "./cutPlan.js";
import { cutsToKeepSegments } from "./cutPlan.js";

/**
 * Best-effort removal of a partial output file left behind by a failed
 * ffmpeg run (non-zero exit, or the 5-minute timeout SIGKILL in
 * ffmpeg.ts's runCommand) — otherwise those partial bytes stay on disk
 * forever under VIDEO_STORAGE_ROOT. Never throws: a missing file (ENOENT,
 * the common case — ffmpeg failed before writing anything) is silently
 * ignored, and any other cleanup error is only logged, so cleanup can
 * never mask the original ffmpeg failure it's meant to run alongside.
 */
async function cleanupPartialOutput(outputPath: string): Promise<void> {
  try {
    await unlink(outputPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[video/transform] failed to clean up partial output ${outputPath}:`, err);
    }
  }
}

/** Runs an ffmpeg command that writes to outputPath, cleaning up any partial file it left behind on failure. */
async function runFfmpegToFile(args: string[], outputPath: string): Promise<void> {
  try {
    await runFfmpeg(args);
  } catch (err) {
    await cleanupPartialOutput(outputPath);
    throw err;
  }
}

export async function extractAudio(videoPath: string, outputWavPath: string): Promise<void> {
  await runFfmpeg(["-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", outputWavPath]);
}

/**
 * Removes the cut segments (PROJECT_SPEC.md: "предложенный план вырезок")
 * by keeping only the surviving segments, trimmed and concatenated. If
 * there are no cuts, just copies the source through unchanged rather than
 * re-encoding for nothing.
 */
export async function applyCuts(
  inputPath: string,
  outputPath: string,
  cuts: VideoCut[],
  videoDurationSeconds: number
): Promise<void> {
  if (cuts.length === 0) {
    await runFfmpegToFile(["-i", inputPath, "-c", "copy", outputPath], outputPath);
    return;
  }

  const keep = cutsToKeepSegments(cuts, videoDurationSeconds);
  if (keep.length === 0) {
    throw new Error("cut plan would remove the entire video");
  }

  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  keep.forEach((seg, i) => {
    filterParts.push(
      `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`,
      `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`
    );
    concatInputs.push(`[v${i}][a${i}]`);
  });
  filterParts.push(`${concatInputs.join("")}concat=n=${keep.length}:v=1:a=1[outv][outa]`);

  await runFfmpegToFile(
    [
      "-i",
      inputPath,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      outputPath,
    ],
    outputPath
  );
}

export interface VerticalCropOptions {
  outputWidth?: number;
  outputHeight?: number;
}

/**
 * "Безопасное" vertical crop: a centered crop to 9:16, then scale to the
 * target size. Centered is the safe default in the absence of subject/face
 * tracking — this deliberately does not claim smarter framing than that
 * (see PROJECT_SPEC.md appendix G: no complex cinematic editing in MVP).
 */
export async function cropToVertical(
  inputPath: string,
  outputPath: string,
  opts: VerticalCropOptions = {}
): Promise<void> {
  const outputWidth = opts.outputWidth ?? 1080;
  const outputHeight = opts.outputHeight ?? 1920;
  const targetAspect = 9 / 16;

  const probe = await probeVideo(inputPath);
  let cropW: number;
  let cropH: number;
  if (probe.width / probe.height > targetAspect) {
    cropH = probe.height;
    cropW = Math.round(cropH * targetAspect);
  } else {
    cropW = probe.width;
    cropH = Math.round(cropW / targetAspect);
  }
  // ffmpeg's crop filter requires even dimensions for most yuv420p encoders.
  cropW -= cropW % 2;
  cropH -= cropH % 2;
  const x = Math.floor((probe.width - cropW) / 2);
  const y = Math.floor((probe.height - cropH) / 2);

  await runFfmpegToFile(
    [
      "-i",
      inputPath,
      "-vf",
      `crop=${cropW}:${cropH}:${x}:${y},scale=${outputWidth}:${outputHeight}`,
      "-c:a",
      "copy",
      outputPath,
    ],
    outputPath
  );
}

/**
 * Loudness normalization (EBU R128 via ffmpeg's loudnorm) plus a light
 * noise reduction pass — "нормализация громкости + базовое уменьшение
 * шума" from PROJECT_SPEC.md section 9.
 */
export async function normalizeAudio(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpegToFile(
    [
      "-i",
      inputPath,
      "-af",
      "afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:v",
      "copy",
      outputPath,
    ],
    outputPath
  );
}

/** Embeds subtitles as a soft (selectable) track — no burn-in, no libass dependency at runtime. */
export async function embedSubtitles(
  inputPath: string,
  srtPath: string,
  outputPath: string
): Promise<void> {
  await runFfmpegToFile(
    ["-i", inputPath, "-i", srtPath, "-map", "0", "-map", "1", "-c", "copy", "-c:s", "mov_text", outputPath],
    outputPath
  );
}

export async function generateCover(
  inputPath: string,
  outputPath: string,
  atSeconds: number
): Promise<void> {
  await runFfmpegToFile(["-ss", String(atSeconds), "-i", inputPath, "-vframes", "1", outputPath], outputPath);
}

export interface RenderOptions {
  maxWidth?: number;
  videoBitrateKbps?: number;
}

/** Low-resolution/bitrate render for the pre-publish preview step. */
export async function renderPreview(
  inputPath: string,
  outputPath: string,
  opts: RenderOptions = {}
): Promise<void> {
  const maxWidth = opts.maxWidth ?? 480;
  const videoBitrateKbps = opts.videoBitrateKbps ?? 600;
  await runFfmpegToFile(
    [
      "-i",
      inputPath,
      "-vf",
      `scale=${maxWidth}:-2`,
      "-b:v",
      `${videoBitrateKbps}k`,
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      outputPath,
    ],
    outputPath
  );
}

export async function renderFinal(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpegToFile(
    ["-i", inputPath, "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-c:a", "aac", "-b:a", "160k", outputPath],
    outputPath
  );
}
