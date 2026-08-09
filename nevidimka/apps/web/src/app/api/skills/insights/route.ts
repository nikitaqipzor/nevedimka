import { NextResponse } from "next/server";
import { getSkillsProgress, logAiCall } from "@nevidimka/db";
import { AiRateLimitExceededError, guideSkills } from "@nevidimka/ai";
import { requireSession } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const skills = await getSkillsProgress(session.userId);

  let result: Awaited<ReturnType<typeof guideSkills>>;
  try {
    result = await guideSkills({ skills }, session.userId);
  } catch (err) {
    if (err instanceof AiRateLimitExceededError) {
      return NextResponse.json({ code: "AI_RATE_LIMIT_EXCEEDED", message: err.message }, { status: 429 });
    }
    throw err;
  }

  await logAiCall({
    userId: session.userId,
    role: "skills_mentor",
    input: { skillCount: skills.length },
    output: result.output,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  });

  return NextResponse.json({ guidance: result.output.guidance });
}
