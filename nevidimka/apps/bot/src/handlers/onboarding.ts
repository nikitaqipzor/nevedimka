import { createMilestone, createMission, getActiveMission, logAiCall, setProgramLength } from "@nevidimka/db";
import { draftMission } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import {
  day0ConfirmKeyboard,
  directionsKeyboard,
  mainReplyKeyboard,
  missionDraftKeyboard,
  programLengthKeyboard,
} from "../keyboards.js";
import type { BotContext } from "../types.js";

export async function startOnboarding(ctx: BotContext): Promise<void> {
  const userId = ctx.session.userId!;
  const activeMission = await getActiveMission(userId);
  if (activeMission) {
    await ctx.reply(
      `У тебя уже есть активная система: «${activeMission.title}».\nИспользуй /today, чтобы увидеть план на сегодня.`,
      { reply_markup: mainReplyKeyboard() }
    );
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
  await ctx.reply("Формулирую миссию и этапы пути…");

  // Deliberately keep ctx.session.awaiting as "onboarding_directions" until
  // after draftMission succeeds — if the AI call throws (rate limit,
  // transient API error, schema mismatch), bot.catch sends a generic error
  // but the user can still press "Готово" again to retry, instead of losing
  // their direction selections and being forced back to /start.
  const userId = ctx.session.userId!;
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

  // Re-check for an active mission right before creating one. A double-tap
  // or a redelivered Telegram callback can re-enter this handler before the
  // first pass finishes, and there is no DB-level unique constraint backing
  // "one active mission per user" to catch that race — so this check is the
  // last line of defense against creating a second mission silently hidden
  // behind getActiveMission's created_at-desc ordering.
  const activeMission = await getActiveMission(userId);
  if (activeMission) {
    ctx.session.missionDraft = undefined;
    ctx.session.onboardingDraft = undefined;
    await ctx.reply(
      `У тебя уже есть активная система: «${activeMission.title}».\nИспользуй /today, чтобы увидеть план на сегодня.`,
      { reply_markup: mainReplyKeyboard() }
    );
    return;
  }

  const draft = ctx.session.missionDraft;
  const onboardingDraft = ctx.session.onboardingDraft;
  if (!draft || !onboardingDraft?.commitmentText || !onboardingDraft.programLength) {
    await ctx.reply("Черновик миссии не найден, начни заново с /start.");
    return;
  }

  await setProgramLength(userId, onboardingDraft.programLength);
  const mission = await createMission({
    userId,
    title: draft.title,
    description: draft.description,
    directions: draft.directions,
    commitmentText: onboardingDraft.commitmentText,
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
