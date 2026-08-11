import { NextRequest, NextResponse } from "next/server";
import { getActiveMissions, getMissionById, getUserById, listMilestones } from "@nevidimka/db";
import type { MilestoneView } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";
import { dayNumberFor, todayInTimezone } from "@/lib/dates";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });

  const today = todayInTimezone(user.timezone);
  const missionId = req.nextUrl.searchParams.get("missionId");

  // No missionId: list mode for the card list — lightweight progress
  // summary per active mission, no milestones (those are fetched per-goal
  // once a card is tapped, in detail mode below).
  if (!missionId) {
    const missions = await getActiveMissions(session.userId);
    if (missions.length === 0) return NextResponse.json({ state: "no_mission" });

    return NextResponse.json({
      state: "list",
      missions: missions.map((m) => ({
        id: m.id,
        title: m.title,
        dayNumber: dayNumberFor(m.day0Date, today),
        programLength: m.programLength,
      })),
    });
  }

  // Detail mode: keyed off THIS specific mission (not "the" active mission —
  // a user can have several), via getMissionById so a missionId belonging to
  // another user 404s instead of leaking cross-user data.
  const mission = await getMissionById(session.userId, missionId);
  if (!mission) return NextResponse.json({ code: "MISSION_NOT_FOUND" }, { status: 404 });

  const dayNumber = dayNumberFor(mission.day0Date, today);
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
    programLength: mission.programLength,
    milestones: milestoneViews,
  });
}
