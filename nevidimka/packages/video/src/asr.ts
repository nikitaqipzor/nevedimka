import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface VideoTranscript {
  fullText: string;
  segments: TranscriptSegment[];
}

export class AsrNotConfiguredError extends Error {
  constructor() {
    super("Video transcription (ASR) is not configured — set ASR_API_KEY.");
    this.name = "AsrNotConfiguredError";
  }
}

interface OpenAiWhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface OpenAiWhisperResponse {
  text: string;
  segments?: OpenAiWhisperSegment[];
}

/**
 * Transcribes an audio file's speech, with segment-level timestamps, via
 * OpenAI's Whisper API (POST /v1/audio/transcriptions,
 * response_format=verbose_json). Set ASR_API_KEY (an OpenAI API key) to
 * enable; without it, every caller gets AsrNotConfiguredError and the rest
 * of the pipeline gracefully continues without a transcript (see
 * pipeline.ts) exactly as it did before this was implemented.
 *
 * HONEST NOTE, READ BEFORE TRUSTING THIS BLINDLY: this was implemented and
 * tested against a mock server matching OpenAI's documented request/
 * response shape (see test/asr.test.ts) — it has never been exercised
 * against the real api.openai.com with real audio, because that domain
 * isn't reachable from the sandbox this was built in. Every other
 * external integration in this codebase (Telegram, Anthropic) went
 * through the same mock-only verification before being confirmed working
 * against the real thing by the person deploying it — treat the first
 * real transcription the same way: as the actual first test of this
 * specific integration, not as something already proven end to end.
 *
 * Want a different provider, or a self-hosted option (whisper.cpp,
 * faster-whisper) instead of OpenAI? This is the only function that needs
 * to change — everything downstream (subtitle generation via
 * segmentsToSrt, the bot's voice-report transcription) only depends on
 * the VideoTranscript shape returned here, not on which provider produced
 * it.
 */
export async function transcribeVideoAudio(audioPath: string): Promise<VideoTranscript> {
  const apiKey = process.env.ASR_API_KEY;
  if (!apiKey) {
    throw new AsrNotConfiguredError();
  }
  const baseUrl = process.env.ASR_API_BASE_URL ?? "https://api.openai.com";

  const fileBuffer = await readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), basename(audioPath));
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    // A ~3 minute clip (the video pipeline's own duration cap) can
    // realistically take a while to transcribe server-side.
    signal: AbortSignal.timeout(5 * 60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ASR request failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as OpenAiWhisperResponse;
  const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  return { fullText: data.text.trim(), segments };
}
