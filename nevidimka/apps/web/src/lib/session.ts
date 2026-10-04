import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isOwnerTelegramId } from "@nevidimka/shared-types";

export const SESSION_COOKIE_NAME = "nevidimka_session";
const ALG = "HS256";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  telegramId: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string" || typeof payload.telegramId !== "string") {
      return null;
    }
    if (!isOwnerTelegramId(payload.telegramId)) return null;
    return { userId: payload.userId, telegramId: payload.telegramId };
  } catch {
    return null;
  }
}

/** Reads and verifies the session from the current request's cookies. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Convenience for route handlers: returns the session, or a ready-to-return
 * 401 NextResponse. Callers narrow with `instanceof NextResponse`.
 */
export async function requireSession(): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { code: "AUTH_INVALID_INITDATA", message: "No valid session" },
      { status: 401 }
    );
  }
  return session;
}
