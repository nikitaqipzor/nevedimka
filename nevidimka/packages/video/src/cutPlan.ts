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
