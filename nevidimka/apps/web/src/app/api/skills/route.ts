import { NextResponse } from "next/server";
import { getActiveMission, getSkillsProgress } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const [mission, progress] = await Promise.all([
    getActiveMission(session.userId),
    getSkillsProgress(session.userId),
  ]);

  // Directions with no tagged tasks yet still show up (at 0%) so the map
  // reflects the whole mission, not just directions that happen to have data.
  const seen = new Set(progress.map((p) => p.direction));
  const withEmpty = [
    ...progress,
    ...(mission?.directions ?? [])
      .filter((d) => !seen.has(d))
      .map((direction) => ({ direction, totalTasks: 0, doneTasks: 0, completionPercent: 0 })),
  ];

  return NextResponse.json({ skills: withEmpty });
}
