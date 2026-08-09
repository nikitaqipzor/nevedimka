import { NextResponse } from "next/server";
import { listPublications } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const publications = await listPublications(session.userId, 50);
  return NextResponse.json({ publications });
}
