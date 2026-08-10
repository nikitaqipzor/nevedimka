import {
  createMilestone,
  createMission,
  getActiveMissions,
  getUserById,
  logAiCall,
  updateMissionStatus,
  VALID_TRANSITIONS,
} from "@nevidimka/db";
import { draftMission } from "@nevidimka/ai";
import { MAX_ACTIVE_MISSIONS, validateTextLength } from "@nevidimka/shared-types";
import type { Mission } from "@nevidimka/shared-types";
import { InlineKeyboard } from "grammy";
import {
  day0ConfirmKeyboard,
  directionsKeyboard,
  mainReplyKeyboard,
  missionDraftKeyboard,
  programLengthKeyboard,
} from "../keyboards.js";
import { todayInTimezone } from "../utils/dates.js";
import type { BotContext } from "../types.js";

export async function startOnboarding(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const activeMissions = await getActiveMissions(userId);
  if (activeMissions.length >= MAX_ACTIVE_MISSIONS) {
    await replyWithCapReachedMenu(ctx, activeMissions);
    return;
  }

  ctx.session.onboardingDraft = {};
  await ctx.reply(
    "Невидимка. Один инструмент: план, действие, доказательство, разбор — каждый день.\n\n" +
      "Начнём с Дня 0.",
    { reply_markup: day0ConfirmKeyboard() }
  );
}

export async function handleDay0Confirm(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = { kind: "onboarding_commitment" };
  await ctx.reply(
    "День 0 зафиксирован.\n\nНапиши свой договор с собой — честно, своими словами. " +
      "Это то, что ты обещаешь себе на весь путь."
  );
}

export async function handleCommitmentText(ctx: BotContext, text: string): Promise<void> {
  const lengthError = validateTextLength("onboardingText", text);
  if (lengthError) {
    await ctx.reply(lengthError);
    return; // stays in "onboarding_commitment" awaiting state
  }
  ctx.session.onboardingDraft = { ...ctx.session.onboardingDraft, commitmentText: text };
  ctx.session.awaiting = { kind: "onboarding_goal" };
  await ctx.reply("Принято. Теперь сформулируй главную цель — то, ради чего всё это.");
}

export async function handleGoalText(ctx: BotContext, text: string): Promise<void> {
  const lengthError = validateTextLength("onboardingText", text);
  if (lengthError) {
    await ctx.reply(lengthError);
    return; // stays in "onboarding_goal" awaiting state
  }
  ctx.session.onboardingDraft = { ...ctx.session.onboardingDraft, goalText: text };
  ctx.session.awaiting = undefined;
  await ctx.reply("На сколько дней рассчитываем путь?", {
    reply_markup: programLengthKeyboard(),
  });
}

export async function handleProgramLength(ctx: BotContext, length: 180 | 365): Promise<void> {
  ctx.session.onboardingDraft = { ...ctx.session.onboardingDraft, programLength: length };
  ctx.session.awaiting = { kind: "onboarding_directions", selected: [] };
  await ctx.reply("Выбери направления (можно несколько), затем «Готово»:", {
    reply_markup: directionsKeyboard([]),
  });
}

export async function handleDirectionToggle(ctx: BotContext, direction: string): Promise<void> {
  const awaiting = ctx.session.awaiting;
  if (!awaiting || awaiting.kind !== "onboarding_directions") return;
  const selected = awaiting.selected.includes(direction)
    ? awaiting.selected.filter((d) => d !== direction)
    : [...awaiting.selected, direction];
  ctx.session.awaiting = { kind: "onboarding_directions", selected };
  await ctx.editMessageReplyMarkup({ reply_markup: directionsKeyboard(selected) });
}

export async function handleDirectionsDone(ctx: BotContext): Promise<void> {
  const awaiting = ctx.session.awaiting;
  const draft = ctx.session.onboardingDraft;
  if (!awaiting || awaiting.kind !== "onboarding_directions" || !draft?.goalText || !draft.programLength) {
    await ctx.reply("Что-то пошло не так, начни заново с /start.");
    return;
  }

  const userId = ctx.session.userId!;

  // Re-check the cap here too, right before the AI draft call — a user who
  // was under the cap when startOnboarding ran can still hit it by the time
  // they finish picking directions (e.g. another mission was accepted from a
  // second device in between). Catching it here means a user already at cap
  // never triggers a wasted (and billed) AI call.
  const activeMissions = await getActiveMissions(userId);
  if (activeMissions.length >= MAX_ACTIVE_MISSIONS) {
    ctx.session.awaiting = undefined;
    ctx.session.onboardingDraft = undefined;
    await replyWithCapReachedMenu(ctx, activeMissions);
    return;
  }

  await ctx.reply("Формулирую миссию и этапы пути…");

  // Deliberately keep ctx.session.awaiting as "onboarding_directions" until
  // after draftMission succeeds — if the AI call throws (rate limit,
  // transient API error, schema mismatch), bot.catch sends a generic error
  // but the user can still press "Готово" again to retry, instead of losing
  // their direction selections and being forced back to /start.
  const { output, tokensIn, tokensOut, costUsd } = await draftMission(
    {
      rawGoalText: draft.goalText,
      programLength: draft.programLength,
      directions: awaiting.selected,
    },
    userId
  );
  await logAiCall({
    userId,
    role: "strategist",
    input: { rawGoalText: draft.goalText, programLength: draft.programLength },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });

  ctx.session.awaiting = undefined;
  ctx.session.onboardingDraft = {
    ...draft,
  };
  ctx.session.missionDraft = { ...output, directions: awaiting.selected };

  const milestonesText = output.milestones
    .map((m: { title: string; target_day: number }) => `  • день ${m.target_day}: ${m.title}`)
    .join("\n");
  await ctx.reply(
    `Миссия: ${output.title}\n${output.description}\n\nЭтапы:\n${milestonesText}`,
    { reply_markup: missionDraftKeyboard() }
  );
}

export async function handleMissionAccept(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;

  // Re-check the active-mission cap right before creating one. A double-tap
  // or a redelivered Telegram callback can re-enter this handler before the
  // first pass finishes — but unlike the old singular-mission version of
  // this check, this is no longer the last line of defense: the
  // `enforce_active_mission_limit` DB trigger (added in a prior migration
  // task) is the actual hard guarantee against exceeding MAX_ACTIVE_MISSIONS.
  // This app-level check is purely a UX nicety, avoiding an insert that we
  // already know the trigger would reject.
  const activeMissions = await getActiveMissions(userId);
  if (activeMissions.length >= MAX_ACTIVE_MISSIONS) {
    ctx.session.missionDraft = undefined;
    ctx.session.onboardingDraft = undefined;
    await replyWithCapReachedMenu(ctx, activeMissions);
    return;
  }

  const draft = ctx.session.missionDraft;
  const onboardingDraft = ctx.session.onboardingDraft;
  if (!draft || !onboardingDraft?.commitmentText || !onboardingDraft.programLength) {
    await ctx.reply("Черновик миссии не найден, начни заново с /start.");
    return;
  }

  const user = await getUserById(userId);
  if (!user) {
    await ctx.reply("Не нашёл профиль, начни заново с /start.");
    return;
  }
  const day0Date = todayInTimezone(user.timezone);

  const mission = await createMission({
    userId,
    title: draft.title,
    description: draft.description,
    directions: draft.directions,
    commitmentText: onboardingDraft.commitmentText,
    day0Date,
    programLength: onboardingDraft.programLength,
  });
  for (const m of draft.milestones) {
    await createMilestone({
      userId,
      missionId: mission.id,
      title: m.title,
      targetDay: m.target_day,
    });
  }

  ctx.session.missionDraft = undefined;
  ctx.session.onboardingDraft = undefined;

  await ctx.reply(
    `Готово. Система запущена: «${mission.title}».\n\n` +
      `Команда /today покажет план на сегодня.\n` +
      `Совет: настрой /settings — часовой пояс и время, когда присылать утренний план и ` +
      `вечерний разбор. Без этого бот не будет писать первым.`,
    { reply_markup: mainReplyKeyboard() }
  );
}

export async function handleMissionRetry(ctx: BotContext): Promise<void> {
  ctx.session.awaiting = { kind: "onboarding_goal" };
  await ctx.reply("Хорошо, сформулируй цель ещё раз — своими словами.");
}

/**
 * Shown when a user tries to start a new goal ("add a goal") while already
 * at MAX_ACTIVE_MISSIONS active missions. Offers a "Завершить"/"Отложить"
 * button per active mission so the user can free up a slot without leaving
 * the chat.
 */
async function replyWithCapReachedMenu(ctx: BotContext, missions: Mission[]): Promise<void> {
  const lines = missions.map((m) => `• ${m.title}`).join("\n");
  const keyboard = new InlineKeyboard();
  for (const m of missions) {
    keyboard.text(`Завершить: ${m.title}`, `mission_complete:${m.id}`).row();
    keyboard.text(`Отложить: ${m.title}`, `mission_pause:${m.id}`).row();
  }
  await ctx.reply(
    `У тебя уже ${missions.length} активных целей — это максимум:\n${lines}\n\nЗаверши или отложи одну, чтобы добавить новую.`,
    { reply_markup: keyboard }
  );
}

export async function handleMissionCompleteCallback(ctx: BotContext, missionId: string): Promise<void> {
  await applyMissionStatusFromCapMenu(ctx, missionId, "completed");
}

export async function handleMissionPauseCallback(ctx: BotContext, missionId: string): Promise<void> {
  await applyMissionStatusFromCapMenu(ctx, missionId, "paused");
}

/**
 * Serializes applyMissionStatusFromCapMenuLocked calls per (userId,
 * missionId), same pattern as middlewares/sequentialize.ts's per-chat
 * queue. updateMissionStatus is a bare UPDATE with no `WHERE status =
 * 'active'` guard and no self-validation (by design — see its doc comment
 * in packages/db/src/repository.ts), and the enforce_active_mission_limit
 * DB trigger only fires for `new.status = 'active'`, so it gives zero
 * protection for pause/complete transitions. Telegram redelivers
 * callback_query updates at-least-once, and a user can double-tap either
 * button before the first tap's message re-renders — either case can
 * otherwise land two calls for the same mission close enough together that
 * both read "still active" (via getActiveMissions) before either write
 * commits. Chaining same-mission calls through this map closes that gap
 * for this process: the second call's read only starts after the first
 * call's write has fully committed, so it deterministically sees the
 * post-write state. It does not protect against a write racing in from a
 * different process (a horizontally-scaled deployment) or a different code
 * path (e.g. a future PATCH /api/missions/[id] route) touching the same
 * mission at the same instant — closing that fully needs a DB-level
 * `WHERE status = 'active'` guard on updateMissionStatus, out of this
 * task's file scope (packages/db/src/repository.ts).
 */
const missionStatusLocks = new Map<string, Promise<void>>();

async function applyMissionStatusFromCapMenu(
  ctx: BotContext,
  missionId: string,
  status: "completed" | "paused"
): Promise<void> {
  const userId = ctx.session.userId!;
  const lockKey = `${userId}:${missionId}`;
  const previous = missionStatusLocks.get(lockKey) ?? Promise.resolve();
  let resolveOwn!: () => void;
  const own = new Promise<void>((resolve) => {
    resolveOwn = resolve;
  });
  missionStatusLocks.set(lockKey, own);

  try {
    await previous;
    await applyMissionStatusFromCapMenuLocked(ctx, userId, missionId, status);
  } finally {
    resolveOwn();
    if (missionStatusLocks.get(lockKey) === own) {
      missionStatusLocks.delete(lockKey);
    }
  }
}

/**
 * Both cap-reached-menu buttons (see replyWithCapReachedMenu) only ever
 * target a mission that was active at the time the menu was rendered, and
 * per VALID_TRANSITIONS, "active" is the only status that legally allows
 * either target status ("completed" or "paused") — paused/draft/completed/
 * abandoned never do. So re-fetching active missions and checking that
 * missionId is still among them *is* the transition-validity check
 * updateMissionStatus deliberately leaves to its caller. A miss here means
 * the mission was already resolved another way — reply gracefully instead
 * of crashing or claiming a success that didn't happen.
 *
 * After writing, re-fetch active missions once more and only report success
 * if the mission has actually left the active set — this is the tightest
 * client-side confirmation available without a getMissionById-style repo
 * function (out of scope here): it catches any write that got clobbered by
 * a source this function's own lock can't see (see the lock's doc comment
 * above), instead of blindly trusting our own write and telling the user
 * something that might not match the final DB state.
 */
async function applyMissionStatusFromCapMenuLocked(
  ctx: BotContext,
  userId: string,
  missionId: string,
  status: "completed" | "paused"
): Promise<void> {
  const activeMissions = await getActiveMissions(userId);
  const mission = activeMissions.find((m) => m.id === missionId);
  if (!mission || !VALID_TRANSITIONS.active.includes(status)) {
    await ctx.reply("Эта цель уже не активна — статус менять не нужно.");
    return;
  }

  await updateMissionStatus(userId, missionId, status);

  const stillActive = (await getActiveMissions(userId)).some((m) => m.id === missionId);
  if (stillActive) {
    // Our own write set a non-active status, so still finding it active
    // right after means something else raced in and changed it back (or
    // never actually left "active") — don't claim an outcome we can't
    // confirm.
    await ctx.reply("Не удалось подтвердить изменение статуса — попробуй ещё раз.");
    return;
  }

  const verb = status === "completed" ? "завершена" : "отложена";
  await ctx.reply(`«${mission.title}» ${verb}. Команда /start запустит новую цель.`);
}
