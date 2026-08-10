import {
  createTask,
  getActiveMissions,
  getOrCreateTodayPlan,
  getUserById,
  listTasksForPlan,
  logAiCall,
  saveCheckIn,
  setPlanAiSummary,
} from "@nevidimka/db";
import { planDayForMissions } from "@nevidimka/ai";
import type { DailyCheckIn, DailyPlan, Mission, Task, User } from "@nevidimka/shared-types";
import { createLogger } from "@nevidimka/logger";
import { InlineKeyboard } from "grammy";
import { todayTaskKeyboard } from "../keyboards.js";
import { dayNumberFor, todayInTimezone } from "../utils/dates.js";
import type { BotContext } from "../types.js";

const log = createLogger("bot:today");

export interface OutboundMessage {
  text: string;
  keyboard?: InlineKeyboard;
}

/**
 * ctx-bound handler for the /today command. Pure message construction lives
 * in the exported *Message() builders below so jobs/morning.ts can send the
 * exact same content proactively via bot.api.sendMessage, without needing a
 * live ctx (there is no incoming update to attach one to on a cron tick).
 */
export async function handleToday(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const [user, missions] = await Promise.all([getUserById(userId), getActiveMissions(userId)]);

  if (!user) {
    await ctx.reply("Не нашёл профиль, начни с /start.");
    return;
  }
  if (missions.length === 0) {
    await ctx.reply("Сначала нужно запустить систему: /start.");
    return;
  }

  const today = todayInTimezone(user.timezone);
  // DailyPlan.dayNumber is a single legacy field on the plan row; with N
  // active missions there's no one "the" day number for the plan itself, so
  // the oldest active mission (missions[0], per getActiveMissions' stable
  // created_at/id ordering) stands in as a representative value here.
  // Per-mission day numbers are computed separately below, inside the
  // message builders, from each mission's own day0Date.
  const dayNumber = dayNumberFor(missions[0].day0Date, today);
  const plan = await getOrCreateTodayPlan(userId, today, dayNumber);

  // plan.mainTaskId is a legacy single-task field that createTask no longer
  // writes; with N active missions there can be N main tasks for one plan,
  // so "already planned" is determined by actually looking at the tasks.
  const existingMainTasks = await listTasksForPlan(userId, plan.id);
  const mainTasks = existingMainTasks.filter((t) => t.isMainTask);
  if (mainTasks.length > 0) {
    const msg = await buildExistingPlanMessage(userId, plan, mainTasks, missions);
    await ctx.reply(msg.text, { reply_markup: msg.keyboard });
    return;
  }

  if (plan.checkIn) {
    const msg = await buildGeneratedPlanMessage(userId, user, missions, plan);
    await ctx.reply(msg.text, { reply_markup: msg.keyboard });
    return;
  }

  ctx.session.awaiting = { kind: "checkin", planId: plan.id };
  await ctx.reply(buildCheckInPrompt(missions, today));
}

export function buildCheckInPrompt(missions: Mission[], today: string): string {
  const goalLines = missions.map(
    (m) => `🎯 ${m.title}: день ${dayNumberFor(m.day0Date, today)} из ${m.programLength}`
  );
  return (
    `Никита, статус по целям:\n${goalLines.join("\n")}\n\n` +
    "Оцени по шкале 1-5 через пробел: сон, энергия, настроение, стресс.\n" +
    "Например: 4 3 3 2"
  );
}

/**
 * One "Отчитаться" button per task — deliberately not the full
 * todayTaskKeyboard() button set (focus/coach/report/postpone), so the
 * keyboard for an already-planned day stays readable with up to
 * MAX_ACTIVE_MISSIONS rows instead of growing 4x as wide.
 */
function reportOnlyKeyboard(tasks: Task[]): InlineKeyboard {
  return new InlineKeyboard(tasks.map((t) => [InlineKeyboard.text("Отчитаться", `report:${t.id}`)]));
}

export async function buildExistingPlanMessage(
  userId: string,
  plan: DailyPlan,
  mainTasks: Task[],
  missions: Mission[]
): Promise<OutboundMessage> {
  void userId; // kept for call-site symmetry with buildGeneratedPlanMessage; no DB call needed here

  const missionById = new Map(missions.map((m) => [m.id, m]));
  const lines = [plan.aiSummary ?? "План на сегодня:", ""];
  for (const task of mainTasks) {
    const missionTitle = (task.missionId && missionById.get(task.missionId)?.title) ?? "Цель";
    lines.push(`🎯 ${missionTitle}: ${task.title} (${task.status})`);
  }

  return {
    text: lines.join("\n"),
    keyboard: reportOnlyKeyboard(mainTasks),
  };
}

export function parseCheckIn(text: string): DailyCheckIn | null {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) {
    return null;
  }
  const [sleepQuality, energy, mood, stress] = parts;
  return { sleepQuality, energy, mood, stress };
}

export async function handleCheckInText(ctx: BotContext, text: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "checkin") return;

  const userId = ctx.session.userId!;
  const [user, missions] = await Promise.all([getUserById(userId), getActiveMissions(userId)]);
  if (!user || missions.length === 0) {
    await ctx.reply("Что-то пошло не так с профилем. Попробуй /today ещё раз.");
    return;
  }
  const today = todayInTimezone(user.timezone);
  const plan = await getOrCreateTodayPlan(userId, today, dayNumberFor(missions[0].day0Date, today));

  // grammy's session() plugin only persists ctx.session mutations if the
  // whole update handler resolves without throwing. saveCheckIn below is a
  // durable write that happens before the AI call inside
  // buildGeneratedPlanMessage (planDayForMissions) — if that call throws
  // (rate limit, parse error), the "awaiting = undefined" mutation from a
  // previous invocation gets silently discarded and reverts to "checkin",
  // even though the check-in was already saved. Re-derive from the DB (the
  // source of truth) instead of trusting a possibly-stale session: if this
  // plan already has a check-in, skip straight to showing the plan rather
  // than re-parsing/re-saving/re-running the AI call.
  if (plan.checkIn) {
    ctx.session.awaiting = undefined;
    const msg = await buildGeneratedPlanMessage(userId, user, missions, plan);
    await ctx.reply(msg.text, { reply_markup: msg.keyboard });
    return;
  }

  const checkIn = parseCheckIn(text);
  if (!checkIn) {
    await ctx.reply("Не понял формат. Пришли четыре числа 1-5 через пробел, например: 4 3 3 2");
    return;
  }

  await saveCheckIn(userId, plan.id, checkIn);
  ctx.session.awaiting = undefined;

  const msg = await buildGeneratedPlanMessage(userId, user, missions, plan);
  await ctx.reply(msg.text, { reply_markup: msg.keyboard });
}

export async function buildGeneratedPlanMessage(
  userId: string,
  user: User,
  missions: Mission[],
  plan: DailyPlan
): Promise<OutboundMessage> {
  const today = todayInTimezone(user.timezone);

  // yesterdayMainTaskTitle / yesterdayCompletionPercent are intentionally
  // omitted: computing them per-mission would need a new repository helper
  // (yesterday's plan's tasks filtered by mission_id) that doesn't exist
  // yet. Both fields are optional on DayPlannerForMissionsInput — omitting
  // them only reduces prompt richness, it doesn't block correctness.
  const { output, tokensIn, tokensOut, costUsd } = await planDayForMissions(
    {
      userFirstName: user.firstName ?? "друг",
      checkIn: plan.checkIn ?? {},
      missions: missions.map((m) => ({
        missionId: m.id,
        missionTitle: m.title,
        directions: m.directions,
        dayNumber: dayNumberFor(m.day0Date, today),
        programLength: m.programLength,
      })),
    },
    userId
  );
  await logAiCall({
    userId,
    role: "day_planner",
    input: { missionIds: missions.map((m) => m.id) },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });

  if ("error" in output) {
    return { text: "AI не смог собрать план (нет активной цели). Проверь /start." };
  }

  const missionById = new Map(missions.map((m) => [m.id, m]));
  const tasks: Task[] = [];
  const summaryParts: string[] = [];
  // Known limitation: if createTask throws partway through this loop (e.g.
  // mission 2 of 3), the user is left with a partially-planned day and no
  // clean retry path — the next /today sees the tasks already created and
  // renders an incomplete "existing plan" view, with no way to plan the
  // remaining missions for today. Fixing this (rollback / resumable
  // planning / explicit partial-failure UI) is a design decision out of
  // scope here.
  for (const p of output.plans) {
    const mission = missionById.get(p.mission_id);
    if (!mission) {
      // AI-echoed mission_id doesn't match any mission we sent in the
      // request (hallucination/garbling) — skip rather than let createTask
      // hit a foreign-key failure, but keep a trace instead of silently
      // dropping the plan.
      log.warn({ missionId: p.mission_id, knownMissionIds: [...missionById.keys()] }, "planDayForMissions returned an unknown mission_id, skipping");
      continue;
    }

    const task = await createTask({
      userId,
      dailyPlanId: plan.id,
      missionId: p.mission_id,
      title: p.main_task.title,
      isMainTask: true,
      estimateMinutes: p.main_task.estimate_minutes,
      direction: p.main_task.direction ?? undefined,
    });
    tasks.push(task);

    summaryParts.push(`🎯 ${mission.title}\n${p.summary}\n${p.reasoning_note}`);
  }

  const summary = summaryParts.join("\n\n");
  await setPlanAiSummary(userId, plan.id, summary);

  // new InlineKeyboard() defaults to inline_keyboard = [[]] (one leading
  // empty row) and .append() only pushes rows on top of that, never
  // removing it — build straight from the row arrays instead, same fix as
  // reportOnlyKeyboard above, to avoid a leading empty row in the keyboard.
  const keyboard = new InlineKeyboard(tasks.flatMap((t) => todayTaskKeyboard(t.id).inline_keyboard));

  return { text: summary, keyboard };
}
