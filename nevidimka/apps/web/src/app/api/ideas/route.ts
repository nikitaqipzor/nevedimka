import { NextRequest, NextResponse } from "next/server";
import { addIdea, listInboxIdeas } from "@nevidimka/db";
import { validateTextLength } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const ideas = await listInboxIdeas(session.userId);
  return NextResponse.json({ ideas });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "text is required" }, { status: 400 });
  }
  const lengthError = validateTextLength("ideaText", text);
  if (lengthError) {
    return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
  }

  const idea = await addIdea(session.userId, text);
  return NextResponse.json({ ok: true, idea });
}
