import { NextRequest, NextResponse } from "next/server";
import {
  createMilestone,
  createMission,
  getActiveMission,
  getUserById,
  listMilestones,
  logAiCall,
  replaceMilestones,
  setDay0Date,
  setProgramLength,
  updateMission,
} from "@nevidimka/db";
import { AiRateLimitExceededError, draftMission } from "@nevidimka/ai";
import { validateTextLength, type MilestoneView } from "@nevidimka/shared-types";
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
  if (!mission) {
    // programLength is returned even with no mission so the onboarding form
    // can preselect the user's current setting rather than guessing.
    return NextResponse.json({ state: "no_mission", programLength: user.programLength });
  }

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

/**
 * Onboarding and mission editing from the Mini App.
 *
 * Why this exists: PROJECT_SPEC.md section 20's Release 2 acceptance
 * criterion is that everything the bot collects is "видны И РЕДАКТИРУЕМЫ в
 * Mini App". Missions were the gap — /path was read-only, so the only way to
 * start a path or change a goal was the bot's /start conversation, and both
 * the Today and Path screens just said "Заверши онбординг в боте".
 *
 * Deliberately mirrors apps/bot/src/handlers/onboarding.ts rather than
 * inventing a second flow: same steps, same strategist role, same
 * one-active-mission rule. The bot walks them one message at a time because
 * that is what a chat can do; the web collects them in one form and submits
 * once, which is what a screen can do. Both end at the same two calls
 * (createMission + createMilestone), so neither channel owns business logic
 * the other lacks — PROJECT_SPEC.md section 6's requirement.
 */
type PathAction =
  | {
      action: "draft_mission";
      goalText: string;
      programLength: 180 | 365;
      directions: string[];
    }
  | {
      action: "create_mission";
      title: string;
      description?: string;
      directions: string[];
      commitmentText: string;
      programLength: 180 | 365;
      day0Date?: string;
      milestones: { title: string; targetDay: number }[];
    }
  | {
      action: "update_mission";
      title?: string;
      description?: string;
      directions?: string[];
      commitmentText?: string;
    }
  | {
      action: "replace_milestones";
      milestones: { title: string; targetDay: number }[];
    };

function badRequest(message: string): NextResponse {
  return NextResponse.json({ code: "BAD_REQUEST", message }, { status: 400 });
}

/**
 * Built per call, not hoisted to a module constant: a NextResponse carries a
 * single-use body stream, so a shared instance would fail the second time it
 * was returned within the same process.
 */
function missionExists(): NextResponse {
  return NextResponse.json(
    { code: "MISSION_EXISTS", message: "У тебя уже есть активная миссия." },
    { status: 409 }
  );
}

/** Shared validation for the milestone list, used by create and replace. */
function validateMilestones(
  milestones: unknown,
  programLength: number
): { ok: true; value: { title: string; targetDay: number }[] } | { ok: false; error: string } {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { ok: false, error: "Нужен хотя бы один этап." };
  }
  if (milestones.length > 5) {
    return { ok: false, error: "Не больше пяти этапов." };
  }

  const value: { title: string; targetDay: number }[] = [];
  for (const m of milestones) {
    const title = typeof m?.title === "string" ? m.title.trim() : "";
    const targetDay = Number(m?.targetDay);
    if (!title) return { ok: false, error: "У этапа должно быть название." };
    const lengthError = validateTextLength("onboardingText", title);
    if (lengthError) return { ok: false, error: lengthError };
    if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > programLength) {
      return { ok: false, error: `День этапа должен быть от 1 до ${programLength}.` };
    }
    value.push({ title, targetDay });
  }

  // Sorted by day so the Path screen's timeline and listMilestones' ORDER BY
  // agree regardless of the order the form submitted them in.
  value.sort((a, b) => a.targetDay - b.targetDay);
  return { ok: true, value };
}

function validateDirections(
  directions: unknown
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(directions) || directions.length === 0) {
    return { ok: false, error: "Выбери хотя бы одно направление." };
  }
  if (directions.length > 5) {
    return { ok: false, error: "Не больше пяти направлений." };
  }
  const value: string[] = [];
  for (const d of directions) {
    const name = typeof d === "string" ? d.trim() : "";
    if (!name) return { ok: false, error: "Направление не может быть пустым." };
    if (name.length > 40) return { ok: false, error: "Слишком длинное направление." };
    value.push(name);
  }
  return { ok: true, value };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const body = (await req.json().catch(() => null)) as PathAction | null;
  if (!body?.action) return badRequest("missing action");

  switch (body.action) {
    /**
     * Step 5 of onboarding: hand the raw goal to the strategist and return
     * its proposed mission + milestones WITHOUT persisting anything. The user
     * reviews the draft and then submits create_mission — mirroring the bot,
     * where "Принять" is a separate press. PROJECT_SPEC.md section 5 marks
     * the strategist's output as requiring user confirmation.
     */
    case "draft_mission": {
      const goalText = body.goalText?.trim() ?? "";
      const goalError = validateTextLength("onboardingText", goalText);
      if (goalError) return badRequest(goalError);

      if (body.programLength !== 180 && body.programLength !== 365) {
        return badRequest("programLength должен быть 180 или 365.");
      }
      const dirs = validateDirections(body.directions);
      if (!dirs.ok) return badRequest(dirs.error);

      if (await getActiveMission(userId)) return missionExists();

      try {
        const { output, tokensIn, tokensOut, costUsd } = await draftMission(
          { rawGoalText: goalText, programLength: body.programLength, directions: dirs.value },
          userId
        );
        await logAiCall({
          userId,
          role: "strategist",
          input: { rawGoalText: goalText, programLength: body.programLength },
          output,
          tokensIn,
          tokensOut,
          costUsd,
        });
        return NextResponse.json({
          ok: true,
          draft: {
            title: output.title,
            description: output.description,
            directions: dirs.value,
            milestones: output.milestones.map((m) => ({
              title: m.title,
              targetDay: m.target_day,
            })),
          },
        });
      } catch (err) {
        if (err instanceof AiRateLimitExceededError) {
          return NextResponse.json(
            { code: "AI_RATE_LIMIT_EXCEEDED", message: err.message },
            { status: 429 }
          );
        }
        throw err;
      }
    }

    /**
     * Final step: persist the confirmed mission. Everything is validated
     * again here rather than trusting that draft_mission produced it — the
     * user can edit the strategist's proposal before accepting, and this
     * endpoint is reachable directly.
     */
    case "create_mission": {
      const title = body.title?.trim() ?? "";
      const titleError = validateTextLength("onboardingText", title);
      if (titleError) return badRequest(titleError);

      const commitmentText = body.commitmentText?.trim() ?? "";
      const commitmentError = validateTextLength("onboardingText", commitmentText);
      if (commitmentError) return badRequest(commitmentError);

      if (body.programLength !== 180 && body.programLength !== 365) {
        return badRequest("programLength должен быть 180 или 365.");
      }
      const dirs = validateDirections(body.directions);
      if (!dirs.ok) return badRequest(dirs.error);

      const ms = validateMilestones(body.milestones, body.programLength);
      if (!ms.ok) return badRequest(ms.error);

      if (body.day0Date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.day0Date)) {
        return badRequest("day0Date должен быть в формате YYYY-MM-DD.");
      }

      // Same guard as the bot's handleMissionAccept, for the same reason: a
      // double submit can re-enter this before the first finishes. Unlike the
      // bot's version, this one is backed by a real DB invariant
      // (uq_missions_one_active_per_user, migration 008), so the catch below
      // turns that constraint into a clean 409 instead of a 500.
      if (await getActiveMission(userId)) return missionExists();

      await setProgramLength(userId, body.programLength);
      if (body.day0Date) await setDay0Date(userId, body.day0Date);

      let mission;
      try {
        mission = await createMission({
          userId,
          title,
          description: body.description?.trim() || undefined,
          directions: dirs.value,
          commitmentText,
        });
      } catch (err) {
        if ((err as { code?: string }).code === "23505") return missionExists();
        throw err;
      }

      for (const m of ms.value) {
        await createMilestone({
          userId,
          missionId: mission.id,
          title: m.title,
          targetDay: m.targetDay,
        });
      }

      return NextResponse.json({ ok: true, missionId: mission.id });
    }

    case "update_mission": {
      const mission = await getActiveMission(userId);
      if (!mission) return NextResponse.json({ code: "NO_MISSION" }, { status: 404 });

      const patch: {
        title?: string;
        description?: string | null;
        directions?: string[];
        commitmentText?: string;
      } = {};

      if (body.title !== undefined) {
        const title = body.title.trim();
        const error = validateTextLength("onboardingText", title);
        if (error) return badRequest(error);
        patch.title = title;
      }
      if (body.description !== undefined) {
        const description = body.description.trim();
        if (description) {
          const error = validateTextLength("onboardingText", description);
          if (error) return badRequest(error);
        }
        // Empty string clears it — the column is nullable.
        patch.description = description || null;
      }
      if (body.commitmentText !== undefined) {
        const commitmentText = body.commitmentText.trim();
        const error = validateTextLength("onboardingText", commitmentText);
        if (error) return badRequest(error);
        patch.commitmentText = commitmentText;
      }
      if (body.directions !== undefined) {
        const dirs = validateDirections(body.directions);
        if (!dirs.ok) return badRequest(dirs.error);
        patch.directions = dirs.value;
      }

      if (Object.keys(patch).length === 0) return badRequest("нечего обновлять");

      const updated = await updateMission(userId, mission.id, patch);
      if (!updated) return NextResponse.json({ code: "NO_MISSION" }, { status: 404 });
      return NextResponse.json({ ok: true, mission: updated });
    }

    case "replace_milestones": {
      const [user, mission] = await Promise.all([
        getUserById(userId),
        getActiveMission(userId),
      ]);
      if (!user) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
      if (!mission) return NextResponse.json({ code: "NO_MISSION" }, { status: 404 });

      const ms = validateMilestones(body.milestones, user.programLength);
      if (!ms.ok) return badRequest(ms.error);

      const milestones = await replaceMilestones(userId, mission.id, ms.value);
      return NextResponse.json({ ok: true, milestones });
    }

    default:
      return badRequest("unknown action");
  }
}
