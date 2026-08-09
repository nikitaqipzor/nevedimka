import { AsrNotConfiguredError, transcribeVideoAudio } from "@nevidimka/video";

export { AsrNotConfiguredError };

/**
 * Transcribes a local voice/video file for a text-based evidence report.
 * Delegates to packages/video's transcribeVideoAudio (same ASR_API_KEY,
 * same OpenAI Whisper integration) — see that function's doc comment for
 * the honest caveat about this never having been exercised against the
 * real api.openai.com in this codebase's development history.
 *
 * Returns plain text (the per-segment timestamps that transcribeVideoAudio
 * also produces aren't needed here — that's specifically for generating
 * video subtitles).
 */
export async function transcribeAudio(localFilePath: string): Promise<string> {
  const { fullText } = await transcribeVideoAudio(localFilePath);
  return fullText;
}
