import { runFfprobe } from "./ffmpeg.js";

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

interface FfprobeStream {
  codec_type: string;
  width?: number;
  height?: number;
}

interface FfprobeOutput {
  format: { duration?: string };
  streams: FfprobeStream[];
}

export async function probeVideo(path: string): Promise<VideoProbe> {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  const parsed = JSON.parse(stdout) as FfprobeOutput;

  const videoStream = parsed.streams.find((s) => s.codec_type === "video");
  const audioStream = parsed.streams.find((s) => s.codec_type === "audio");
  if (!videoStream) {
    throw new Error("no video stream found");
  }

  return {
    durationSeconds: Number(parsed.format.duration ?? 0),
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    hasAudio: !!audioStream,
    hasVideo: true,
  };
}

/** Release 4 MVP limits — see PROJECT_SPEC.md section 9 for the full pipeline scope. */
export const VIDEO_LIMITS = {
  maxDurationSeconds: 180,
  minDurationSeconds: 2,
};

export function validateVideoProbe(probe: VideoProbe): { ok: true } | { ok: false; reason: string } {
  if (!probe.hasVideo) return { ok: false, reason: "no video stream" };
  if (probe.durationSeconds > VIDEO_LIMITS.maxDurationSeconds) {
    return { ok: false, reason: `duration exceeds ${VIDEO_LIMITS.maxDurationSeconds}s limit` };
  }
  if (probe.durationSeconds < VIDEO_LIMITS.minDurationSeconds) {
    return { ok: false, reason: `duration below ${VIDEO_LIMITS.minDurationSeconds}s minimum` };
  }
  return { ok: true };
}
