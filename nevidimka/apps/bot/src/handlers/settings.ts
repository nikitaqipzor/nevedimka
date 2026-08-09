import { getUserById, setReminderHours, setTimezone } from "@nevidimka/db";
import type { BotContext } from "../types.js";

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function formatHour(h: number | undefined): string {
  return h == null ? "выключено" : `${h}:00`;
}

export async function handleSettingsRequest(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const user = await getUserById(userId);
  if (!user) {
    await ctx.reply("Не нашёл профиль, начни с /start.");
    return;
  }

  await ctx.reply(
    `Текущие настройки:\n` +
      `Часовой пояс: ${user.timezone}\n` +
      `Утреннее напоминание: ${formatHour(user.reminderHourMorning)}\n` +
      `Вечернее напоминание: ${formatHour(user.reminderHourEvening)}\n\n` +
      `Обновим по порядку. Напиши свой часовой пояс в формате IANA ` +
      `(например: Europe/Moscow, Europe/Amsterdam, Asia/Almaty):`
  );
  ctx.session.awaiting = { kind: "settings_timezone" };
}

export async function handleSettingsTimezoneText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "settings_timezone") return;
  const tz = text.trim();

  if (!isValidTimezone(tz)) {
    await ctx.reply(
      "Не похоже на корректный часовой пояс IANA. Пример правильного формата: Europe/Moscow. Попробуй ещё раз:"
    );
    return; // stays in "settings_timezone"
  }

  const userId = ctx.session.userId!;
  await setTimezone(userId, tz);
  ctx.session.settingsDraft = {};
  ctx.session.awaiting = { kind: "settings_morning_hour" };
  await ctx.reply(
    "Часовой пояс сохранён. В котором часу присылать утренний план? " +
      "Число 0-23 по твоему часовому поясу, или «-» чтобы выключить утренние напоминания:"
  );
}

function parseHourInput(text: string): { ok: true; hour: number | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === "-") return { ok: true, hour: null };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 23) return { ok: false };
  return { ok: true, hour: n };
}

export async function handleSettingsMorningHourText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "settings_morning_hour") return;

  const parsed = parseHourInput(text);
  if (!parsed.ok) {
    await ctx.reply("Пришли число 0-23, или «-» чтобы выключить. Попробуй ещё раз:");
    return;
  }

  ctx.session.settingsDraft = { morningHour: parsed.hour };
  ctx.session.awaiting = { kind: "settings_evening_hour" };
  await ctx.reply(
    "А в котором часу присылать вечерний разбор? Число 0-23, или «-» чтобы выключить:"
  );
}

export async function handleSettingsEveningHourText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "settings_evening_hour") return;

  const parsed = parseHourInput(text);
  if (!parsed.ok) {
    await ctx.reply("Пришли число 0-23, или «-» чтобы выключить. Попробуй ещё раз:");
    return;
  }

  const userId = ctx.session.userId!;
  const morningHour = ctx.session.settingsDraft?.morningHour ?? null;
  await setReminderHours(userId, morningHour, parsed.hour);

  ctx.session.settingsDraft = undefined;
  ctx.session.awaiting = undefined;
  await ctx.reply(
    `Готово.\n` +
      `Утро: ${formatHour(morningHour ?? undefined)}\n` +
      `Вечер: ${formatHour(parsed.hour ?? undefined)}\n\n` +
      `Изменить в любой момент — снова /settings.`
  );
}
