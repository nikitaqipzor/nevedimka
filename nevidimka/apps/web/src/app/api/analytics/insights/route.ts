import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSummary, logAiCall } from "@nevidimka/db";
import { AiRateLimitExceededError, analyzeBehavior } from "@nevidimka/ai";
import { requireSession } from "@/lib/session";

const ALLOWED_PERIODS = [7, 30, 180] as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => ({}))) as { days?: number };
  const days = ALLOWED_PERIODS.includes(body.days as (typeof ALLOWED_PERIODS)[number]) ? body.days! : 7;

  const summary = await getAnalyticsSummary(session.userId, days);

  let result: Awaited<ReturnType<typeof analyzeBehavior>>;
  try {
    result = await analyzeBehavior(
      {
        periodDays: summary.periodDays,
        completionRate: summary.completionRate,
        postponedCount: summary.postponedCount,
        focusMinutesTotal: summary.focusMinutesTotal,
        averageSleep: summary.averageSleep,
        averageEnergy: summary.averageEnergy,
        averageMood: summary.averageMood,
        averageStress: summary.averageStress,
      },
      session.userId
    );
  } catch (err) {
    if (err instanceof AiRateLimitExceededError) {
      return NextResponse.json({ code: "AI_RATE_LIMIT_EXCEEDED", message: err.message }, { status: 429 });
    }
    throw err;
  }

  await logAiCall({
    userId: session.userId,
    role: "behavior_analyst",
    input: { days },
    output: result.output,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  });

  return NextResponse.json({ observations: result.output.observations });
}
