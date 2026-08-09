import { NextRequest, NextResponse } from "next/server";
import { deleteUserAccount } from "@nevidimka/db";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Require an explicit confirmation string in the body — this is
  // irreversible (cascading delete across every table the user owns) and
  // must never happen from a stray/automated request.
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") {
    return NextResponse.json(
      { code: "CONFIRMATION_REQUIRED", message: 'Отправь { "confirm": "DELETE" } для подтверждения.' },
      { status: 400 }
    );
  }

  await deleteUserAccount(session.userId);

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
