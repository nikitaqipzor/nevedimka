import { NextResponse } from "next/server";
import { getActiveMissions, getSkillsProgress } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const [missions, progress] = await Promise.all([
    getActiveMissions(session.userId),
    getSkillsProgress(session.userId),
  ]);

  // Directions with no tagged tasks yet still show up (at 0%) so the map
  // reflects all active missions, not just directions that happen to have data.
  const allDirections = new Set(missions.flatMap((m) => m.directions));
  const seen = new Set(progress.map((p) => p.direction));
  const withEmpty = [
    ...progress,
    ...[...allDirections]
      .filter((d) => !seen.has(d))
      .map((direction) => ({ direction, totalTasks: 0, doneTasks: 0, completionPercent: 0 })),
  ];

  return NextResponse.json({ skills: withEmpty });
}
