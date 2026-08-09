import { countRecentAiCalls } from "@nevidimka/db";

/**
 * Generous enough for genuine single-user daily use (onboarding, day
 * planning, several mentor-chat turns, a report review or two) while
 * catching a runaway loop or bug — not a hard business limit, just a
 * backstop. Tune per deployment via env if one user's normal usage pattern
 * needs more headroom.
 */
export const AI_RATE_LIMIT = {
  windowMinutes: Number(process.env.AI_RATE_LIMIT_WINDOW_MINUTES ?? 60),
  maxCalls: Number(process.env.AI_RATE_LIMIT_MAX_CALLS ?? 40),
};

export class AiRateLimitExceededError extends Error {
  constructor(
    public windowMinutes: number,
    public maxCalls: number
  ) {
    super(
      `Слишком много обращений к AI за последние ${windowMinutes} мин. ` +
        `(лимит ${maxCalls}). Подожди немного и попробуй снова.`
    );
    this.name = "AiRateLimitExceededError";
  }
}

/** Throws AiRateLimitExceededError if the user is over the limit; otherwise resolves. */
export async function assertAiRateLimit(userId: string): Promise<void> {
  const count = await countRecentAiCalls(userId, AI_RATE_LIMIT.windowMinutes);
  if (count >= AI_RATE_LIMIT.maxCalls) {
    throw new AiRateLimitExceededError(AI_RATE_LIMIT.windowMinutes, AI_RATE_LIMIT.maxCalls);
  }
}
