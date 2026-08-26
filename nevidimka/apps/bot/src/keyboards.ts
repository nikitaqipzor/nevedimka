import { InlineKeyboard, Keyboard } from "grammy";
import type { Mission } from "@nevidimka/shared-types";

/**
 * Persistent reply keyboard — always visible below the chat input, unlike
 * InlineKeyboard buttons which are attached to one specific message and
 * scroll away. Button text is literally the slash command itself
 * ("/today", "/idea", ...): tapping one sends that exact string as a
 * message, which grammy's bot.command() matches the same as if it had
 * been typed. This exists because entering every flow required typing a
 * command from memory, with no discoverability — see also
 * registerBotCommands() in bot.ts for the Telegram-native "/" menu, which
 * addresses the same gap a different way.
 */
export function mainReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text("/today")
    .text("/idea")
    .row()
    .text("/evening")
    .text("/post")
    .row()
    .text("/video")
    .text("/settings")
    .row()
    .text("/addgoal")
    .resized();
}

export function day0ConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Зафиксировать День 0", "onboarding:day0_confirm");
}

export function programLengthKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("180 дней", "onboarding:length:180")
    .text("365 дней", "onboarding:length:365");
}

const ALL_DIRECTIONS = ["Создание", "Тело", "Смелость"];

export function directionsKeyboard(selected: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dir of ALL_DIRECTIONS) {
    const mark = selected.includes(dir) ? "✅ " : "";
    kb.text(`${mark}${dir}`, `onboarding:dir_toggle:${dir}`).row();
  }
  kb.text("Готово", "onboarding:dir_done");
  return kb;
}

export function missionDraftKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Принять", "onboarding:mission_accept")
    .text("Переформулировать", "onboarding:mission_retry");
}

export function todayTaskKeyboard(mainTaskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Начать фокус", `focus:start:${mainTaskId}`)
    .text("Разбить задачу", `coach:${mainTaskId}`)
    .row()
    .text("Отчитаться", `report:${mainTaskId}`)
    .text("Перенести", `task:postpone:${mainTaskId}`);
}

export function postSourceKeyboard(evidences: { id: string; preview: string }[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const e of evidences) {
    kb.text(e.preview, `post:source:${e.id}`).row();
  }
  kb.text("Написать текст заново", "post:source:new");
  return kb;
}

export function postVersionsKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Бережная", `post:pick:gentle:${draftId}`)
    .text("Структурная", `post:pick:structured:${draftId}`)
    .row()
    .text("Краткая", `post:pick:short:${draftId}`)
    .text("Как есть", `post:pick:original:${draftId}`)
    .row()
    .text("Своя версия", `post:pick:custom:${draftId}`);
}

export function postConfirmKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Опубликовать", `post:publish:${draftId}`)
    .text("Отмена", `post:cancel:${draftId}`);
}

/**
 * Shown when a post's publish is ambiguous because the user has more than
 * one active mission (see handlePostPublish in handlers/content.ts) — lets
 * them pick which mission's day counter/program the post header should use.
 * This is the publish-time fallback, used only for drafts with no mission
 * already attributed (e.g. created before this attribution existed, or
 * while 0 missions were active) — see postCreateMissionPickKeyboard below
 * for the creation-time counterpart that avoids this ambiguity up front.
 */
export function postMissionPickKeyboard(draftId: string, missions: Mission[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of missions) {
    kb.text(m.title, `post:publish_mission:${draftId}:${m.id}`).row();
  }
  return kb;
}

/**
 * Shown at post *creation* time (before a content draft even exists) when
 * the user has 2+ active missions, so the resulting draft can be attributed
 * to a mission up front — see resolveMissionAndStartEditing in
 * handlers/content.ts. Keyed only by mission id since there's no draftId
 * yet, unlike postMissionPickKeyboard's publish-time fallback above.
 */
export function postCreateMissionPickKeyboard(missions: Mission[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of missions) {
    kb.text(m.title, `post:create_mission:${m.id}`).row();
  }
  return kb;
}

export function videoConfirmKeyboard(videoAssetId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Подтвердить и опубликовать", `video:confirm:${videoAssetId}`)
    .row()
    .text("Отмена", `video:cancel:${videoAssetId}`);
}

export function focusActiveKeyboard(sessionId: string): InlineKeyboard {
  return new InlineKeyboard().text("Завершить фокус", `focus:stop:${sessionId}`);
}
