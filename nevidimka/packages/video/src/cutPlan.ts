import type { SilenceInterval } from "./silence.js";

export interface VideoCut {
  start: number;
  end: number;
  reason: string;
}

export interface CutPlanOptions {
  /** Silences shorter than this are natural pauses, not worth cutting. */
  minCutDurationSeconds?: number;
  /** Leaves a small buffer of silence around cuts so speech doesn't feel clipped. */
  paddingSeconds?: number;
}

/**
 * Proposes cuts from silence intervals: only silences long enough to be a
 * "dead" gap (not natural breathing-room pauses) become cut candidates,
 * and each cut keeps a small padding buffer so the edit doesn't feel
 * abrupt. This is a plain, deterministic function — no AI call, no
 * transcript required — so it's part of the pipeline that works
 * regardless of whether ASR is configured (see asr.ts).
 */
export function proposeCutsFromSilence(
  silences: SilenceInterval[],
  videoDurationSeconds: number,
  opts: CutPlanOptions = {}
): VideoCut[] {
  const minCutDuration = opts.minCutDurationSeconds ?? 1.5;
  const padding = opts.paddingSeconds ?? 0.3;

  const cuts: VideoCut[] = [];
  for (const s of silences) {
    const duration = s.end - s.start;
    if (duration < minCutDuration) continue;

    const start = Math.min(s.start + padding, videoDurationSeconds);
    const end = Math.max(s.end - padding, start);
    if (end <= start) continue;

    cuts.push({
      start,
      end,
      reason: `тишина ${duration.toFixed(1)}с`,
    });
  }
  return cuts;
}

/** Inverts a cut plan into the segments that should actually be kept in the render. */
export function cutsToKeepSegments(
  cuts: VideoCut[],
  videoDurationSeconds: number
): { start: number; end: number }[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const keep: { start: number; end: number }[] = [];
  let cursor = 0;

  for (const cut of sorted) {
    if (cut.start > cursor) {
      keep.push({ start: cursor, end: cut.start });
    }
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < videoDurationSeconds) {
    keep.push({ start: cursor, end: videoDurationSeconds });
  }
  return keep.filter((seg) => seg.end - seg.start > 0.05);
}

/**
 * Remaps transcript segment timestamps from the ORIGINAL timeline onto the
 * post-cut timeline, so subtitles stay in sync with the video that cuts
 * were actually applied to.
 *
 * Why this exists: runPipelineToPreview transcribes the original audio
 * (timestamps relative to the original duration), then applyCuts physically
 * removes the cut ranges and rebases the result with
 * setpts=PTS-STARTPTS/concat — which compresses the timeline. Embedding the
 * untouched original timestamps into that shortened video drifts every
 * caption forward by the total duration removed before it, accumulating
 * over the clip. Since cuts come from silences >= 1.5s, which are common in
 * real speech, the drift reaches whole seconds by the end.
 *
 * Mapping rule, matching cutsToKeepSegments' output exactly (that function
 * is the single source of truth for what survives the edit):
 *  - a segment is clipped to each kept interval it overlaps, so a caption
 *    spanning a cut is split into the parts that remain audible;
 *  - the surviving part's timestamps are shifted back by the amount of
 *    footage removed before it (its offset within the concatenated output);
 *  - a segment falling entirely inside a cut is dropped — that speech is
 *    no longer in the video, so a caption for it would be a lie;
 *  - degenerate slivers shorter than 10ms are dropped: SRT's millisecond
 *    resolution can't represent them, and a zero-length cue is invalid.
 *
 * Text is duplicated across split parts rather than apportioned: there is
 * no word-level timing available here (Whisper's verbose_json gives
 * segment-level timestamps — see asr.ts), and showing the full line for
 * both halves reads far better than truncating mid-sentence.
 */
export function remapSegmentsToKeptTimeline<T extends { start: number; end: number }>(
  segments: T[],
  keep: { start: number; end: number }[]
): T[] {
  const remapped: T[] = [];
  let elapsed = 0;

  for (const kept of keep) {
    const keptDuration = kept.end - kept.start;

    for (const seg of segments) {
      const overlapStart = Math.max(seg.start, kept.start);
      const overlapEnd = Math.min(seg.end, kept.end);
      if (overlapEnd - overlapStart < 0.01) continue;

      remapped.push({
        ...seg,
        start: elapsed + (overlapStart - kept.start),
        end: elapsed + (overlapEnd - kept.start),
      });
    }

    elapsed += keptDuration;
  }

  return remapped.sort((a, b) => a.start - b.start);
}
