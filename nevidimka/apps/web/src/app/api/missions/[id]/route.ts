import { NextRequest, NextResponse } from "next/server";
import { getMissionById, updateMissionStatus, VALID_TRANSITIONS } from "@nevidimka/db";
import type { MissionStatus } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";

type RouteParams = { params: Promise<{ id: string }> };

const VALID_STATUSES: MissionStatus[] = ["completed", "abandoned", "paused", "active"];

/**
 * "Завершить"/"Отложить" (and reactivate) from the Mini App's Путь screen.
 * Mirrors the transition semantics of the bot's mission_complete/mission_pause
 * callbacks (apps/bot/src/handlers/onboarding.ts) and reuses the same
 * VALID_TRANSITIONS graph so both surfaces agree on what's legal.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id: missionId } = await params;

  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (typeof status !== "string" || !VALID_STATUSES.includes(status as MissionStatus)) {
    return NextResponse.json(
      { code: "INVALID_STATUS", message: "Некорректный статус цели." },
      { status: 400 }
    );
  }

  // getMissionById is ownership-scoped: a missionId belonging to a different
  // user returns null exactly like a nonexistent id, so this 404s without
  // leaking whether the row exists at all.
  const current = await getMissionById(session.userId, missionId);
  if (!current) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "Цель не найдена." },
      { status: 404 }
    );
  }

  const allowed = VALID_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(status as MissionStatus)) {
    return NextResponse.json(
      {
        code: "INVALID_TRANSITION",
        message: "Это действие сейчас недоступно для этой цели — возможно, её статус уже изменился.",
      },
      { status: 409 }
    );
  }

  try {
    const updated = await updateMissionStatus(session.userId, missionId, status as MissionStatus);
    return NextResponse.json({ mission: updated });
  } catch (err) {
    // Reactivating a paused/draft mission to 'active' re-enters the
    // enforce_active_mission_limit trigger (migration 011) — the same
    // race-safe cap check createMission relies on. At the cap, the trigger
    // raises `active mission cap (%) exceeded for user %` with
    // `using errcode = 'check_violation'`, which node-postgres surfaces as a
    // DatabaseError with `.code === '23514'` (the Postgres SQLSTATE for
    // check_violation). That must not become an unhandled 500 — translate it
    // into a clear 409 instead. The message substring check is a fallback in
    // case the driver/error shape ever changes and `.code` isn't present.
    const pgErr = err as { code?: string; message?: string };
    const isCapError =
      pgErr?.code === "23514" ||
      /cap|exceeded/i.test(pgErr?.message ?? "");
    if (isCapError) {
      return NextResponse.json(
        {
          code: "ACTIVE_MISSION_CAP_EXCEEDED",
          message: "Нельзя вернуть цель в активные — достигнут лимит активных целей.",
        },
        { status: 409 }
      );
    }
    throw err;
  }
}
