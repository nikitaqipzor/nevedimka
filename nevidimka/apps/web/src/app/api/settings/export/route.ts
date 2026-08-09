import { NextResponse } from "next/server";
import { exportUserData } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const data = await exportUserData(session.userId);
  const json = JSON.stringify(data, null, 2);

  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="nevidimka-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
