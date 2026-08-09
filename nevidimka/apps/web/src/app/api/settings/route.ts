import { NextRequest, NextResponse } from "next/server";
import { getUserById, setReminderHours, setTimezone } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    timezone: user.timezone,
    reminderHourMorning: user.reminderHourMorning ?? null,
    reminderHourEvening: user.reminderHourEvening ?? null,
    programLength: user.programLength,
    day0Date: user.day0Date,
    channelId: user.channelId ?? null,
  });
}

type SettingsUpdate = {
  timezone?: string;
  reminderHourMorning?: number | null;
  reminderHourEvening?: number | null;
};

function isValidHour(h: unknown): h is number | null {
  return h === null || (typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const body = (await req.json().catch(() => null)) as SettingsUpdate | null;
  if (!body) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "invalid body" }, { status: 400 });
  }

  if (body.timezone !== undefined) {
    if (!isValidTimezone(body.timezone)) {
      return NextResponse.json(
        { code: "INVALID_TIMEZONE", message: "Не похоже на корректный часовой пояс IANA (например, Europe/Moscow)." },
        { status: 400 }
      );
    }
    await setTimezone(userId, body.timezone);
  }

  if (body.reminderHourMorning !== undefined || body.reminderHourEvening !== undefined) {
    if (!isValidHour(body.reminderHourMorning) || !isValidHour(body.reminderHourEvening)) {
      return NextResponse.json(
        { code: "INVALID_HOUR", message: "Час должен быть числом 0-23 или null (выключено)." },
        { status: 400 }
      );
    }
    // Both hours must be written together (the repository function sets
    // both columns in one UPDATE) — fetch the current value for whichever
    // one wasn't part of this request so it isn't accidentally cleared.
    const current = await getUserById(userId);
    const morning = body.reminderHourMorning !== undefined ? body.reminderHourMorning : (current?.reminderHourMorning ?? null);
    const evening = body.reminderHourEvening !== undefined ? body.reminderHourEvening : (current?.reminderHourEvening ?? null);
    await setReminderHours(userId, morning, evening);
  }

  const updated = await getUserById(userId);
  return NextResponse.json({
    ok: true,
    timezone: updated?.timezone,
    reminderHourMorning: updated?.reminderHourMorning ?? null,
    reminderHourEvening: updated?.reminderHourEvening ?? null,
  });
}
