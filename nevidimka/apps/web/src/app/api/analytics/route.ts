import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSummary } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

const ALLOWED_PERIODS = [7, 30, 180] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const days = ALLOWED_PERIODS.includes(daysParam as (typeof ALLOWED_PERIODS)[number])
    ? daysParam
    : 7;

  const summary = await getAnalyticsSummary(session.userId, days);
  return NextResponse.json({ summary, availablePeriods: ALLOWED_PERIODS });
}
