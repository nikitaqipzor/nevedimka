import { NextResponse } from "next/server";
import { listEvidencesForUser } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const evidences = await listEvidencesForUser(session.userId, 50);
  return NextResponse.json({ evidences });
}
