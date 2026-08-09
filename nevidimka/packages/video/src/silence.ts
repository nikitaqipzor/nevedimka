import { runFfmpeg } from "./ffmpeg.js";

export interface SilenceInterval {
  start: number;
  end: number;
}

export interface SilenceDetectOptions {
  /** Audio level below which is considered silence, in dB (negative). */
  noiseFloorDb?: number;
  /** Minimum duration for a gap to count as silence, in seconds. */
  minDurationSeconds?: number;
}

const START_RE = /silence_start:\s*([\d.]+)/;
const END_RE = /silence_end:\s*([\d.]+)/;

/**
 * Detects silent gaps in a video/audio file using ffmpeg's silencedetect
 * filter. This is the algorithmic half of "поиск дублей и длинных пауз"
 * (PROJECT_SPEC.md section 9) — it needs no transcript and no AI call, so
 * it works even when ASR isn't configured (see asr.ts).
 */
export async function detectSilences(
  inputPath: string,
  opts: SilenceDetectOptions = {}
): Promise<SilenceInterval[]> {
  const noiseFloorDb = opts.noiseFloorDb ?? -30;
  const minDurationSeconds = opts.minDurationSeconds ?? 0.6;

  const { stderr } = await runFfmpeg([
    "-i",
    inputPath,
    "-af",
    `silencedetect=noise=${noiseFloorDb}dB:d=${minDurationSeconds}`,
    "-f",
    "null",
    "-",
  ]);

  const intervals: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const startMatch = line.match(START_RE);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(END_RE);
    if (endMatch && pendingStart !== null) {
      intervals.push({ start: pendingStart, end: Number(endMatch[1]) });
      pendingStart = null;
    }
  }

  return intervals;
}
