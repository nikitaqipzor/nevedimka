import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface ParsedInitData {
  user: TelegramInitDataUser;
  authDate: number;
}

/**
 * Validates Telegram Mini App initData per Telegram's documented algorithm
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = <bot_token>)
 *   data_check_string = every field except `hash`, sorted by key, "key=value" joined by "\n"
 *   valid iff HEX(HMAC_SHA256(key = secret_key, message = data_check_string)) === hash
 *
 * Throws on any failure — callers should treat that uniformly as "reject
 * the request", not branch on which check failed (that just narrates the
 * boundary to whoever is probing it).
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): ParsedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData: missing hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const computedHashBuf = Buffer.from(computedHash, "hex");
  const hashBuf = Buffer.from(hash, "hex");
  if (
    computedHashBuf.length !== hashBuf.length ||
    !timingSafeEqual(computedHashBuf, hashBuf)
  ) {
    throw new Error("initData: signature mismatch");
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new Error("initData: expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("initData: missing user field");
  const user = JSON.parse(userRaw) as TelegramInitDataUser;

  return { user, authDate };
}
