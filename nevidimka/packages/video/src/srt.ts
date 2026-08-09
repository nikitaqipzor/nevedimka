import type { TranscriptSegment } from "./asr.js";

function formatSrtTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const msRemainder = ms % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msRemainder, 3)}`;
}

/** Renders transcript segments as an SRT subtitle file's text content. */
export function segmentsToSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, i) => {
      const index = i + 1;
      const timing = `${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}`;
      return `${index}\n${timing}\n${seg.text.trim()}\n`;
    })
    .join("\n");
}
