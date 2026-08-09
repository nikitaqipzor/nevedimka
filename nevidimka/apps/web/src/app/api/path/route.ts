import { NextResponse } from "next/server";
import { getActiveMission, getUserById, listMilestones } from "@nevidimka/db";
import type { MilestoneView } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";
import { dayNumberFor, todayInTimezone } from "@/lib/dates";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const [user, mission] = await Promise.all([
    getUserById(session.userId),
    getActiveMission(session.userId),
  ]);
  if (!user) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
  if (!mission) return NextResponse.json({ state: "no_mission" });

  const today = todayInTimezone(user.timezone);
  const dayNumber = dayNumberFor(user.day0Date, today);
  const milestones = await listMilestones(session.userId, mission.id);

  // Display-only status: the stored status never changes itself in
  // Release 1/2 (no UI writes it yet), so we derive "passed" / "current"
  // from today's day number rather than mislabeling an unverified milestone
  // as genuinely "done" — see MilestoneView's doc comment.
  let currentAssigned = false;
  const milestoneViews: MilestoneView[] = milestones.map((m) => {
    if (m.status === "done" || m.status === "skipped") {
      return { ...m, status: m.status };
    }
    if (m.targetDay < dayNumber) {
      return { ...m, status: "passed" };
    }
    if (!currentAssigned) {
      currentAssigned = true;
      return { ...m, status: "current" };
    }
    return { ...m, status: "planned" };
  });

  return NextResponse.json({
    state: "ready",
    mission: {
      id: mission.id,
      title: mission.title,
      description: mission.description,
      directions: mission.directions,
      commitmentText: mission.commitmentText,
    },
    dayNumber,
    programLength: user.programLength,
    milestones: milestoneViews,
  });
}
