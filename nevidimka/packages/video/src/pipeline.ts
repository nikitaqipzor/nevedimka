import { join } from "node:path";
import { probeVideo, validateVideoProbe, type VideoProbe } from "./probe.js";
import { detectSilences } from "./silence.js";
import { proposeCutsFromSilence, type VideoCut } from "./cutPlan.js";
import { transcribeVideoAudio, type VideoTranscript } from "./asr.js";
import { segmentsToSrt } from "./srt.js";
import {
  applyCuts,
  cropToVertical,
  embedSubtitles,
  extractAudio,
  generateCover,
  normalizeAudio,
  renderFinal,
  renderPreview,
} from "./transform.js";

export interface PipelineToPreviewResult {
  probe: VideoProbe;
  transcript: VideoTranscript | null;
  cuts: VideoCut[];
  /** Fully processed (cuts + crop + normalize + subtitles-if-any) master, ready for final render. */
  processedPath: string;
  coverPath: string;
  previewPath: string;
}

/**
 * Runs the pipeline from the raw upload through the preview step
 * (PROJECT_SPEC.md section 9, up to "Preview"). Publish/confirm happen
 * outside this function, on an explicit user action.
 *
 * ASR is best-effort — whether it's unconfigured (see asr.ts), or
 * transcribeVideoAudio() throws for any other reason (a transient OpenAI
 * error, a timeout, a network blip), this function does not fail: it
 * continues without a transcript, which means no subtitles and no
 * AI-assisted semantic cut suggestions, but cuts from silence detection,
 * vertical crop, audio normalization, cover, and preview all still run.
 */
export async function runPipelineToPreview(
  sourcePath: string,
  workDir: string
): Promise<PipelineToPreviewResult> {
  const probe = await probeVideo(sourcePath);
  const validation = validateVideoProbe(probe);
  if (!validation.ok) {
    throw new Error(`video rejected: ${validation.reason}`);
  }

  const audioPath = join(workDir, "audio.wav");
  await extractAudio(sourcePath, audioPath);

  let transcript: VideoTranscript | null = null;
  try {
    transcript = await transcribeVideoAudio(audioPath);
  } catch (err) {
    // Any ASR failure — not configured (AsrNotConfiguredError), a
    // transient OpenAI 4xx/5xx, the 5-minute request timeout, or a plain
    // network error — should degrade gracefully, not abort the whole
    // pipeline and discard the cut-detection/crop/normalize work already
    // done. Continue without a transcript (no subtitles, no AI-assisted
    // cut suggestions).
    console.warn(
      `[video/pipeline] ASR transcription failed, continuing without transcript: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const silences = await detectSilences(sourcePath);
  const cuts = proposeCutsFromSilence(silences, probe.durationSeconds);

  const cutsAppliedPath = join(workDir, "01-cuts.mp4");
  await applyCuts(sourcePath, cutsAppliedPath, cuts, probe.durationSeconds);

  const verticalPath = join(workDir, "02-vertical.mp4");
  await cropToVertical(cutsAppliedPath, verticalPath);

  const normalizedPath = join(workDir, "03-normalized.mp4");
  await normalizeAudio(verticalPath, normalizedPath);

  let processedPath = normalizedPath;
  if (transcript && transcript.segments.length > 0) {
    const srtPath = join(workDir, "captions.srt");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(srtPath, segmentsToSrt(transcript.segments), "utf8");

    const subtitledPath = join(workDir, "04-subtitled.mp4");
    await embedSubtitles(normalizedPath, srtPath, subtitledPath);
    processedPath = subtitledPath;
  }

  const coverPath = join(workDir, "cover.jpg");
  // Roughly 10% into the video, floored at 0.5s (so very short clips don't
  // grab frame 0) and capped at 0.5s before the end (so very short clips
  // don't overshoot past the last frame).
  const coverAt = Math.min(
    Math.max(probe.durationSeconds * 0.1, 0.5),
    Math.max(probe.durationSeconds - 0.5, 0)
  );
  await generateCover(processedPath, coverPath, coverAt);

  const previewPath = join(workDir, "preview.mp4");
  await renderPreview(processedPath, previewPath);

  return { probe, transcript, cuts, processedPath, coverPath, previewPath };
}

/** Final quality render, run only after the user confirms the preview. */
export async function runFinalRender(processedPath: string, outputPath: string): Promise<void> {
  await renderFinal(processedPath, outputPath);
}
