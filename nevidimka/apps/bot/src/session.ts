import { MemorySessionStorage, session } from "grammy";
import type { SessionData } from "./types.js";

/**
 * Release 1 runs a single process with in-memory session storage. This is
 * fine for one operator (the "Никита" scenario in PROJECT_SPEC.md) but does
 * not survive a process restart mid-conversation, and won't scale past one
 * process. If that becomes a problem, swap this for a Postgres- or
 * Redis-backed StorageAdapter — every call site here only depends on the
 * StorageAdapter interface (read/write/delete), not on it being in-memory.
 */
export const sessionStorage = new MemorySessionStorage<SessionData>();

export function initialSession(): SessionData {
  return { awaiting: undefined };
}

export const sessionMiddleware = session({
  initial: initialSession,
  storage: sessionStorage,
});

/**
 * Telegram private-chat IDs are numerically identical to the user's
 * Telegram ID, and grammy's default session key for private chats is the
 * chat ID as a string — so this is the same key the middleware itself
 * would compute for an incoming update from that user. Jobs use this to
 * write "awaiting" state before proactively sending a message.
 */
export function sessionKeyForTelegramId(telegramId: string): string {
  return telegramId;
}

export async function readSession(telegramId: string): Promise<SessionData> {
  const existing = await sessionStorage.read(sessionKeyForTelegramId(telegramId));
  return existing ?? initialSession();
}

export async function writeSession(telegramId: string, data: SessionData): Promise<void> {
  await sessionStorage.write(sessionKeyForTelegramId(telegramId), data);
}
