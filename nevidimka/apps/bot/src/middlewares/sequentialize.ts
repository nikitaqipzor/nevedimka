import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../types.js";

/**
 * Long polling hands grammy's own update loop updates for one bot one at a
 * time, so a single process naturally processes them in sequence. Webhook
 * mode (used in production — see index.ts's TELEGRAM_WEBHOOK_URL branch)
 * instead gets each incoming HTTP POST handed to Express independently, with
 * no ordering or mutual-exclusion guarantee: two updates for the same chat
 * (a double-tap, or Telegram's own redelivery) can run concurrently and race
 * on the plain read-then-write of `ctx.session` (see session.ts — there is
 * no locking in MemorySessionStorage).
 *
 * This middleware — registered first in bot.ts, before sessionMiddleware —
 * forces updates that share a session key to run one at a time, in arrival
 * order, while updates for different chats still run fully concurrently. It
 * keys on `ctx.chatId`, the same value grammy's session() plugin uses by
 * default (see session.ts's sessionKeyForTelegramId comment), so "same
 * session key" here means exactly "same session record".
 */
export function sequentialize(): MiddlewareFn<BotContext> {
  const tails = new Map<string, Promise<void>>();

  return async (ctx, next) => {
    const key = ctx.chatId?.toString();
    if (key === undefined) {
      await next();
      return;
    }

    // Chain this update onto whatever is currently in flight for this key
    // (or a resolved promise if nothing is). Storing `own` back into the
    // map synchronously — before the first `await` below — means any other
    // update for the same key that arrives while we're running will chain
    // after us, not after `previous`.
    const previous = tails.get(key) ?? Promise.resolve();
    let resolveOwn!: () => void;
    const own = new Promise<void>((resolve) => {
      resolveOwn = resolve;
    });
    tails.set(key, own);

    try {
      await previous;
      await next();
    } finally {
      resolveOwn();
      // Only delete if nobody chained after us, so the map doesn't grow
      // unboundedly while also not clobbering a newer in-flight entry.
      if (tails.get(key) === own) {
        tails.delete(key);
      }
    }
  };
}
