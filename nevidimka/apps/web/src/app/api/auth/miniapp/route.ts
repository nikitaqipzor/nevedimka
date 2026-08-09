import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@nevidimka/db";
import { validateInitData } from "@/lib/telegramAuth";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const initData = typeof body.initData === "string" ? body.initData : "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  let telegramId: string;
  let firstName: string | undefined;
  let username: string | undefined;

  if (initData && botToken) {
    try {
      const parsed = validateInitData(initData, botToken);
      telegramId = String(parsed.user.id);
      firstName = parsed.user.first_name;
      username = parsed.user.username;
    } catch (err) {
      return NextResponse.json(
        { code: "AUTH_INVALID_INITDATA", message: (err as Error).message },
        { status: 401 }
      );
    }
  } else if (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_AUTH === "true" &&
    process.env.OWNER_TELEGRAM_ID
  ) {
    // Local dev convenience: there is no Telegram host to supply initData
    // when testing in a plain browser tab. Never active in production, and
    // requires an explicit opt-in flag so a misconfigured NODE_ENV (e.g. an
    // unset value on staging) can't accidentally enable this bypass.
    telegramId = process.env.OWNER_TELEGRAM_ID;
  } else {
    return NextResponse.json(
      { code: "AUTH_INVALID_INITDATA", message: "initData required" },
      { status: 401 }
    );
  }

  const user = await getOrCreateUser({ telegramId, firstName, username });
  const token = await createSessionToken({ userId: user.id, telegramId: user.telegramId });

  const res = NextResponse.json({ ok: true, userId: user.id });
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // The Mini App runs inside Telegram's webview as a cross-site iframe in
    // production, which requires SameSite=None (and therefore Secure). In
    // local dev (plain browser tab, likely http://localhost) that
    // combination would be rejected by the browser, so relax it.
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
