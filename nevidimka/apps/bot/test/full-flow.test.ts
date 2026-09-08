// Full user-journey test through the real bot (onboarding → daily cycle →
// focus → coach → report → ideas → evening → text publication →
// idempotency check). Run:
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/full-flow.test.ts
// (DATABASE_URL must be a superuser connection — the test creates and
// drops its own throwaway database.)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { MAX_ACTIVE_MISSIONS } from "@nevidimka/shared-types";
import { startMockAnthropic } from "./mock-anthropic.js";
import { startMockTelegram, lastBotReply, type MockTelegramCall } from "./mock-telegram.js";
import { addDaysToDateString, todayInTimezone } from "../src/utils/dates.js";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_bot_full_flow_test";
const CHAT_ID = 555000111;
// Separate chat ids for Task 18's multi-goal scenarios below, so they run as
// their own independent users rather than interleaving with CHAT_ID's
// carefully-sequenced single-mission story above (which already has a plan
// for "today" and a reported/postponed task by the time those tests run).
const CHAT_ID_TWO_GOALS = 555000222;
const CHAT_ID_CAP = 555000333;

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

let updateId = 1;
function textUpdate(text: string, chatId: number = CHAT_ID): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private", first_name: "Никита" },
      from: { id: chatId, is_bot: false, first_name: "Никита" },
      text,
      ...(text.startsWith("/")
        ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] }
        : {}),
    },
  } as unknown as Update;
}
function callbackUpdate(data: string, chatId: number = CHAT_ID): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: chatId, is_bot: false, first_name: "Никита" },
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private", first_name: "Никита" },
        from: { id: 1, is_bot: true, first_name: "Test" },
        text: "...",
      },
      chat_instance: "1",
      data,
    },
  } as unknown as Update;
}

/**
 * Walks one chat through the full onboarding flow (Day 0 confirm ->
 * commitment -> goal -> program length -> directions -> AI strategist draft
 * -> accept), producing one new active mission. Mirrors the
 * "onboarding: Day 0 button -> ... -> accept" test above step by step,
 * factored out so the multi-goal scenarios below can drive it repeatedly —
 * once per goal, and again per cap-scenario mission — without retyping the
 * whole sequence each time. Assumes the triggering command (/start or
 * /addgoal) was already sent and produced the Day 0 confirm keyboard.
 */
async function completeOnboardingFlow(
  chatId: number,
  opts: { commitmentText: string; goalText: string; programLength: 180 | 365; directions: string[] }
): Promise<void> {
  await bot.handleUpdate(callbackUpdate("onboarding:day0_confirm", chatId));
  await bot.handleUpdate(textUpdate(opts.commitmentText, chatId));
  await bot.handleUpdate(textUpdate(opts.goalText, chatId));
  await bot.handleUpdate(callbackUpdate(`onboarding:length:${opts.programLength}`, chatId));
  for (const direction of opts.directions) {
    await bot.handleUpdate(callbackUpdate(`onboarding:dir_toggle:${direction}`, chatId));
  }
  await bot.handleUpdate(callbackUpdate("onboarding:dir_done", chatId));
  await bot.handleUpdate(callbackUpdate("onboarding:mission_accept", chatId));
}

let bot: Bot<any>;
let tgCalls: MockTelegramCall[];
let mockAi: Awaited<ReturnType<typeof startMockAnthropic>>;
let mockTg: Awaited<ReturnType<typeof startMockTelegram>>;
let db: typeof import("@nevidimka/db");
let userId: string;
let mainTaskId: string;
let draftId: string;
// State shared between the two-goal /today scenario and the report-against-
// the-second-goal scenario immediately below it (both run against
// CHAT_ID_TWO_GOALS) — see the comments on those tests.
let userIdTwoGoals: string;
let missionOneId: string;
let missionTwoId: string;

async function dbRows(sql: string): Promise<any[]> {
  const client = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  await client.connect();
  const r = await client.query(sql);
  await client.end();
  return r.rows;
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const migrationsDir = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const dbAdmin = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  await dbAdmin.connect();
  for (const file of files) {
    await dbAdmin.query(readFileSync(join(migrationsDir, file), "utf8"));
  }
  await dbAdmin.end();

  process.env.DATABASE_URL = urlForDb(TEST_DB);
  process.env.TELEGRAM_CHANNEL_ID = "@test_channel";
  process.env.AI_RATE_LIMIT_MAX_CALLS = "1000";

  mockAi = await startMockAnthropic();
  mockTg = await startMockTelegram();
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_API_BASE_URL = mockAi.url;
  process.env.TELEGRAM_BOT_TOKEN = "TEST:TOKEN";
  process.env.TELEGRAM_API_BASE_URL = mockTg.url;
  tgCalls = mockTg.calls;

  db = await import("@nevidimka/db");
  const { createBot } = await import("../dist/bot.js");
  bot = createBot("TEST:TOKEN", { apiRoot: mockTg.url });
  bot.botInfo = {
    id: 1, is_bot: true, first_name: "Test", username: "test_bot",
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  } as any;
});

after(async () => {
  await db.closePool();
  await mockAi?.close();
  await mockTg?.close();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.end();
});

test("onboarding: /start creates a user and shows Day 0", async () => {
  await bot.handleUpdate(textUpdate("/start"));
  const users = await dbRows(`select * from users where telegram_id = '${CHAT_ID}'`);
  assert.equal(users.length, 1);
  userId = users[0].id;
  assert.match(lastBotReply(tgCalls) ?? "", /Дня 0/);
});

test("/post: publish refuses gracefully when the user has no active missions yet", async () => {
  // Runs before onboarding creates a mission, so the user genuinely has
  // zero active missions here. handlePostPublish checks the active-mission
  // count before it ever looks at the draft, so a nonexistent draftId is
  // fine — this must never get far enough to touch the drafts table.
  await bot.handleUpdate(callbackUpdate("post:publish:00000000-0000-0000-0000-000000000000"));
  assert.match(lastBotReply(tgCalls) ?? "", /актив/i);
  const publications = await dbRows(`select * from publications where user_id = '${userId}'`);
  assert.equal(publications.length, 0, "no active mission means nothing should be published");
});

test("/evening: refuses gracefully when the user has no active missions yet", async () => {
  // Same zero-mission window as the /post test above — runs before
  // onboarding creates a mission. handleEveningRequest checks the
  // active-mission count before creating/touching today's plan, so this
  // must never get far enough to write a daily_plans row.
  const plansBefore = await dbRows(`select * from daily_plans where user_id = '${userId}'`);
  await bot.handleUpdate(textUpdate("/evening"));
  assert.match(lastBotReply(tgCalls) ?? "", /нечего подводить/i);
  const plansAfter = await dbRows(`select * from daily_plans where user_id = '${userId}'`);
  assert.equal(plansAfter.length, plansBefore.length, "no active mission means no daily_plan should be created");
});

test("onboarding: Day 0 button -> commitment -> goal -> length -> directions -> AI strategist -> accept", async () => {
  await bot.handleUpdate(callbackUpdate("onboarding:day0_confirm"));
  assert.match(lastBotReply(tgCalls) ?? "", /договор/);

  await bot.handleUpdate(textUpdate("Обещаю себе доводить начатое до конца."));
  assert.match(lastBotReply(tgCalls) ?? "", /цель/);

  await bot.handleUpdate(textUpdate("Запустить свой продукт и обрести дисциплину."));
  assert.match(lastBotReply(tgCalls) ?? "", /дней/);

  await bot.handleUpdate(callbackUpdate("onboarding:length:180"));
  assert.match(lastBotReply(tgCalls) ?? "", /направлени/);

  await bot.handleUpdate(callbackUpdate("onboarding:dir_toggle:Создание"));
  await bot.handleUpdate(callbackUpdate("onboarding:dir_toggle:Тело"));
  const edits = tgCalls.filter((c) => c.method === "editMessageReplyMarkup");
  assert.equal(edits.length, 2);

  await bot.handleUpdate(callbackUpdate("onboarding:dir_done"));
  assert.ok(await dbRows(`select 1 from ai_logs where user_id = '${userId}' and role = 'strategist'`));
  assert.match(lastBotReply(tgCalls) ?? "", /Запустить личный проект дисциплины/);

  await bot.handleUpdate(callbackUpdate("onboarding:mission_accept"));
  const missions = await dbRows(`select * from missions where user_id = '${userId}' and status = 'active'`);
  assert.equal(missions.length, 1);
  assert.equal(missions[0].title, "Запустить личный проект дисциплины");
  const milestones = await dbRows(`select * from milestones where mission_id = '${missions[0].id}'`);
  assert.equal(milestones.length, 2);
  assert.match(lastBotReply(tgCalls) ?? "", /\/settings/);
});

test("/today: check-in -> AI day plan -> tasks written with direction preserved", async () => {
  await bot.handleUpdate(textUpdate("/today"));
  await bot.handleUpdate(textUpdate("4 3 4 2"));

  const plans = await dbRows(`select * from daily_plans where user_id = '${userId}'`);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].sleep_quality, 4);

  // planDayForMissions (the multi-mission day planner) writes exactly one
  // main task per active mission — the old single-mission planner's separate
  // "additional_tasks" concept was removed when the planner was rewritten
  // for multi-goal support (no `additional_tasks` field exists anywhere in
  // MultiMissionDayPlannerOutputSchema or the codebase anymore), so with one
  // active mission here, /today produces exactly one task, not two.
  const tasks = await dbRows(`select * from tasks where user_id = '${userId}'`);
  assert.equal(tasks.length, 1);
  const mainTask = tasks[0];
  assert.equal(mainTask.is_main_task, true);
  assert.equal(mainTask.title, "Настроить окружение проекта");
  assert.equal(mainTask.direction, "Создание");
  mainTaskId = mainTask.id;
});

test("focus buttons: start -> stop, with duration computed", async () => {
  await bot.handleUpdate(callbackUpdate(`focus:start:${mainTaskId}`));
  let sessions = await dbRows(`select * from focus_sessions where user_id = '${userId}'`);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].ended_at, null);
  const taskAfterStart = await dbRows(`select * from tasks where id = '${mainTaskId}'`);
  assert.equal(taskAfterStart[0].status, "in_progress");

  await new Promise((r) => setTimeout(r, 1100));
  await bot.handleUpdate(callbackUpdate(`focus:stop:${sessions[0].id}`));
  sessions = await dbRows(`select * from focus_sessions where user_id = '${userId}'`);
  assert.notEqual(sessions[0].ended_at, null);
  assert.ok(sessions[0].duration_seconds >= 1);
});

test("coach button: AI action coach responds with a first step", async () => {
  await bot.handleUpdate(callbackUpdate(`coach:${mainTaskId}`));
  await bot.handleUpdate(textUpdate("не понимаю, с чего начать"));
  assert.match(lastBotReply(tgCalls) ?? "", /Первый шаг/);
});

test("report button: AI reviewer sets completion + status", async () => {
  await bot.handleUpdate(callbackUpdate(`report:${mainTaskId}`));
  await bot.handleUpdate(textUpdate("Настроил окружение, репозиторий готов."));
  const evidences = await dbRows(`select * from evidences where user_id = '${userId}'`);
  assert.equal(evidences.length, 1);
  const task = await dbRows(`select * from tasks where id = '${mainTaskId}'`);
  assert.equal(task[0].completion_percent, 80);
  assert.equal(task[0].status, "partially_done");
});

test("postpone button on the main task", async () => {
  // No separate "extra task" exists anymore for this single-mission flow
  // (see the /today test above) — this now exercises task:postpone against
  // the same mainTaskId already used by focus/coach/report above. Running
  // after "report button" (which already set it to partially_done) is fine:
  // updateTaskStatus is a bare status UPDATE with no transition guard, so
  // postponing an already-reported task is a legal, observable transition.
  await bot.handleUpdate(callbackUpdate(`task:postpone:${mainTaskId}`));
  const task = await dbRows(`select * from tasks where id = '${mainTaskId}'`);
  assert.equal(task[0].status, "postponed");
});

test("/idea and /evening write to the DB", async () => {
  await bot.handleUpdate(textUpdate("/idea"));
  await bot.handleUpdate(textUpdate("Сделать тёмную тему в Mini App"));
  const ideas = await dbRows(`select * from ideas where user_id = '${userId}'`);
  assert.equal(ideas.length, 1);

  await bot.handleUpdate(textUpdate("/evening"));
  await bot.handleUpdate(textUpdate("День прошёл продуктивно, немного устал."));
  const plan = await dbRows(`select * from daily_plans where user_id = '${userId}'`);
  assert.match(plan[0].evening_review_note ?? "", /продуктивно/);
});

test("/post: AI editor -> privacy check -> publish -> idempotency on retry", async () => {
  await bot.handleUpdate(textUpdate("/post"));
  await bot.handleUpdate(callbackUpdate("post:source:new"));
  await bot.handleUpdate(textUpdate("Сегодня настроил окружение проекта и сделал первый коммит."));

  const drafts = await dbRows(`select * from content_drafts where user_id = '${userId}'`);
  assert.equal(drafts.length, 1);
  draftId = drafts[0].id;
  const versions = await dbRows(`select * from content_versions where draft_id = '${draftId}'`);
  assert.ok(["gentle", "structured", "short"].every((s) => versions.some((v) => v.step === s)));

  // With exactly 1 active mission, resolveMissionAndStartEditing must
  // auto-attribute the new draft to it (no creation-time picker, no null
  // mission_id) — verify this directly against the DB row.
  const activeMissionsAtCreation = await dbRows(
    `select * from missions where user_id = '${userId}' and status = 'active'`
  );
  assert.equal(activeMissionsAtCreation.length, 1, "sanity: exactly one active mission at this point");
  assert.equal(
    drafts[0].mission_id,
    activeMissionsAtCreation[0].id,
    "draft must be auto-attributed to the single active mission"
  );

  await bot.handleUpdate(callbackUpdate(`post:pick:gentle:${draftId}`));
  const draftAfterPick = await dbRows(`select * from content_drafts where id = '${draftId}'`);
  assert.notEqual(draftAfterPick[0].chosen_version_id, null);

  await bot.handleUpdate(callbackUpdate(`post:publish:${draftId}`));
  const sent = tgCalls.find((c) => c.method === "sendMessage" && c.payload.chat_id === "@test_channel");
  assert.ok(sent, "bot must send the post to the channel");
  assert.match(sent!.payload.text as string, /День 1/);
  const publications = await dbRows(`select * from publications where user_id = '${userId}'`);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].status, "published");

  // Idempotency: pressing "publish" again on the same draft must not create a second published row
  await bot.handleUpdate(callbackUpdate(`post:publish:${draftId}`));
  const publicationsAfterRetry = await dbRows(`select * from publications where user_id = '${userId}'`);
  const publishedCount = publicationsAfterRetry.filter((p: any) => p.status === "published").length;
  assert.equal(publishedCount, 1, "unique index must prevent a duplicate published row");
});

test("/post: publish shows a mission picker with 2+ active missions and attributes the post to the chosen one", async () => {
  // A day0Date 10 days back gives this mission an unambiguous, distinct day
  // number/program length from the first mission's ("День 1 из 180"), so
  // the resulting caption proves which mission the post actually got
  // attributed to.
  const day0Date2 = addDaysToDateString(todayInTimezone("Europe/Amsterdam"), -10);
  const mission2 = await db.createMission({
    userId,
    title: "Начать бегать по утрам",
    directions: ["Тело"],
    commitmentText: "Обещаю бегать по утрам.",
    day0Date: day0Date2,
    programLength: 365,
  });
  const activeMissions = await dbRows(
    `select * from missions where user_id = '${userId}' and status = 'active'`
  );
  assert.equal(activeMissions.length, 2, "must now have two active missions");

  // Since resolveMissionAndStartEditing now resolves the mission at
  // *creation* time, the "publish-time picker with 2+ active missions"
  // scenario this test wants to exercise can no longer arise through the
  // normal /post conversational flow once 2+ missions are active (the
  // creation-time picker would intercept first — see the dedicated test for
  // that flow below). It can still legitimately happen for a draft that has
  // no attributed mission for some other reason (created before this
  // attribution existed, or while 0 missions were active), so seed that
  // state directly instead of driving it through post:source:new/text.
  const seededDraft = await db.createContentDraft({
    userId,
    sourceText: "Пробежал 5 км утром и записал прогресс.",
  });
  const multiDraftId = seededDraft.id;
  await db.addContentVersion({
    userId,
    draftId: multiDraftId,
    step: "gentle",
    text: "Пробежал 5 км утром и записал прогресс.",
  });
  // Match the end state startEditing would have produced by the time
  // post:pick fires — publishDraftForMission specifically requires
  // "ready_for_review" before it will publish.
  await db.updateDraftStatus(userId, multiDraftId, "ready_for_review");

  await bot.handleUpdate(callbackUpdate(`post:pick:gentle:${multiDraftId}`));

  await bot.handleUpdate(callbackUpdate(`post:publish:${multiDraftId}`));

  // Ambiguous (2 active missions): must show a picker, not publish yet.
  const pickerCall = tgCalls.filter((c) => c.method === "sendMessage").slice(-1)[0];
  const keyboard = (pickerCall?.payload.reply_markup as any)?.inline_keyboard as
    | { text: string; callback_data: string }[][]
    | undefined;
  assert.ok(keyboard, "must show an inline keyboard to pick a mission");
  const buttons = keyboard.flat();
  assert.equal(buttons.length, 2, "must show one button per active mission");
  const mission2Button = buttons.find(
    (b) => b.callback_data === `post:publish_mission:${multiDraftId}:${mission2.id}`
  );
  assert.ok(mission2Button, "must include a button for the newly created mission");
  assert.equal(mission2Button!.text, "Начать бегать по утрам");

  const publicationsBeforeChoice = await dbRows(
    `select * from publications where draft_id = '${multiDraftId}'`
  );
  assert.equal(publicationsBeforeChoice.length, 0, "must not publish before a mission is chosen");

  // Tap the button for the second mission.
  await bot.handleUpdate(callbackUpdate(`post:publish_mission:${multiDraftId}:${mission2.id}`));

  const sentToChannel = tgCalls
    .filter((c) => c.method === "sendMessage" && c.payload.chat_id === "@test_channel")
    .slice(-1)[0];
  assert.ok(sentToChannel, "bot must send the post to the channel once a mission is chosen");
  assert.match(sentToChannel!.payload.text as string, /День 11 из 365/, "caption must use the CHOSEN mission's day/program, not the other one");

  const publicationsAfter = await dbRows(
    `select * from publications where draft_id = '${multiDraftId}'`
  );
  assert.equal(publicationsAfter.length, 1);
  assert.equal(publicationsAfter[0].status, "published");
});

test("/post: with 2+ active missions, the creation-time picker attributes the draft up front and publish skips its own picker", async () => {
  const activeMissionsBefore = await dbRows(
    `select * from missions where user_id = '${userId}' and status = 'active'`
  );
  assert.equal(activeMissionsBefore.length, 2, "must still have two active missions from the previous test");
  const mission2 = activeMissionsBefore.find((m: any) => m.title === "Начать бегать по утрам");
  assert.ok(mission2, "the second mission must still be active");

  const draftsCountBefore = Number(
    (await dbRows(`select count(*) as c from content_drafts where user_id = '${userId}'`))[0].c
  );

  await bot.handleUpdate(textUpdate("/post"));
  await bot.handleUpdate(callbackUpdate("post:source:new"));
  await bot.handleUpdate(textUpdate("Ещё одна пробежка, готовлю пост."));

  // The creation-time picker must appear BEFORE any draft row is written.
  const draftsCountAfterText = Number(
    (await dbRows(`select count(*) as c from content_drafts where user_id = '${userId}'`))[0].c
  );
  assert.equal(
    draftsCountAfterText,
    draftsCountBefore,
    "no draft must be created before a mission is chosen from the creation-time picker"
  );

  const pickerCall = tgCalls.filter((c) => c.method === "sendMessage").slice(-1)[0];
  const keyboard = (pickerCall?.payload.reply_markup as any)?.inline_keyboard as
    | { text: string; callback_data: string }[][]
    | undefined;
  assert.ok(keyboard, "must show an inline keyboard to pick a mission before creating the draft");
  const buttons = keyboard.flat();
  assert.equal(buttons.length, 2, "must show one button per active mission");
  assert.ok(
    buttons.every((b) => b.callback_data.startsWith("post:create_mission:")),
    "buttons must use the creation-time callback prefix"
  );
  const mission2Button = buttons.find((b) => b.callback_data === `post:create_mission:${mission2.id}`);
  assert.ok(mission2Button, "must include a button for the second mission");
  assert.equal(mission2Button!.text, "Начать бегать по утрам");

  // Tap the button for the second mission.
  await bot.handleUpdate(callbackUpdate(`post:create_mission:${mission2.id}`));

  const draftsAfterChoice = await dbRows(
    `select * from content_drafts where user_id = '${userId}' order by created_at desc limit 1`
  );
  assert.equal(draftsAfterChoice.length, 1);
  const newDraftId = draftsAfterChoice[0].id;
  assert.equal(
    draftsAfterChoice[0].mission_id,
    mission2.id,
    "draft must now exist, attributed to the chosen mission"
  );

  await bot.handleUpdate(callbackUpdate(`post:pick:gentle:${newDraftId}`));

  const callCountBeforePublish = tgCalls.length;
  await bot.handleUpdate(callbackUpdate(`post:publish:${newDraftId}`));

  // Must go straight to the channel — no publish-time picker this time,
  // since the draft is already attributed to mission2.
  const sentToChannel = tgCalls
    .filter((c) => c.method === "sendMessage" && c.payload.chat_id === "@test_channel")
    .slice(-1)[0];
  assert.ok(sentToChannel, "bot must send the post to the channel without asking again");
  assert.match(
    sentToChannel!.payload.text as string,
    /День 11 из 365/,
    "caption must use the attributed mission's day/program"
  );

  const callsAfterPublish = tgCalls.slice(callCountBeforePublish);
  const publishTimePicker = callsAfterPublish.find((c) => {
    const inlineKeyboard = (c.payload.reply_markup as any)?.inline_keyboard as
      | { callback_data: string }[][]
      | undefined;
    return (
      c.method === "sendMessage" &&
      inlineKeyboard?.flat().some((b) => b.callback_data.startsWith("post:publish_mission:"))
    );
  });
  assert.equal(
    publishTimePicker,
    undefined,
    "must not show the publish-time mission picker when the draft is already attributed"
  );

  const publications = await dbRows(`select * from publications where draft_id = '${newDraftId}'`);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].status, "published");
});

test("/post: tapping a picker button for a mission that went inactive before the tap fails gracefully", async () => {
  // Same reasoning as the mission-picker test above: with 2+ active
  // missions, the creation-time picker would otherwise intercept before
  // this scenario (publish-time picker on an unattributed draft + the
  // chosen mission going stale) can arise, so seed the unattributed draft
  // directly instead of driving it through post:source:new/text.
  const seededDraft = await db.createContentDraft({
    userId,
    sourceText: "Ещё одна запись для проверки протухшего выбора цели.",
  });
  const staleDraftId = seededDraft.id;
  await db.addContentVersion({
    userId,
    draftId: staleDraftId,
    step: "gentle",
    text: "Ещё одна запись для проверки протухшего выбора цели.",
  });
  // Match the end state startEditing would have produced by the time
  // post:pick fires (see the analogous seeding above).
  await db.updateDraftStatus(userId, staleDraftId, "ready_for_review");
  await bot.handleUpdate(callbackUpdate(`post:pick:gentle:${staleDraftId}`));
  await bot.handleUpdate(callbackUpdate(`post:publish:${staleDraftId}`));

  const activeMissions = await dbRows(
    `select * from missions where user_id = '${userId}' and status = 'active'`
  );
  const staleMission = activeMissions.find((m: any) => m.title === "Начать бегать по утрам");
  assert.ok(staleMission, "the second mission must still exist to go stale");

  // The picker was already shown (its callback data captured this
  // mission's id) — now it goes inactive before the user actually taps.
  await db.updateMissionStatus(userId, staleMission.id, "paused");

  await bot.handleUpdate(callbackUpdate(`post:publish_mission:${staleDraftId}:${staleMission.id}`));
  assert.match(lastBotReply(tgCalls) ?? "", /не актив/i);

  const publications = await dbRows(`select * from publications where draft_id = '${staleDraftId}'`);
  assert.equal(publications.length, 0, "a stale mission choice must not create a publication");
});

test("/export sends a document containing this user's real data", async () => {
  await bot.handleUpdate(textUpdate("/export"));
  const doc = tgCalls.find((c) => c.method === "sendDocument");
  assert.ok(doc, "bot must send a document in response to /export");
});

test("/delete: wrong confirmation text cancels, correct text deletes everything (cascade)", async () => {
  await bot.handleUpdate(textUpdate("/delete"));
  assert.match(lastBotReply(tgCalls) ?? "", /необратимо/i);

  // Wrong confirmation: must NOT delete anything
  await bot.handleUpdate(textUpdate("yes please"));
  assert.match(lastBotReply(tgCalls) ?? "", /Отменено/);
  let stillThere = await dbRows(`select 1 from users where id = '${userId}'`);
  assert.equal(stillThere.length, 1, "wrong confirmation text must not delete the account");

  // Correct confirmation: must delete the user and everything cascading from it
  await bot.handleUpdate(textUpdate("/delete"));
  await bot.handleUpdate(textUpdate("DELETE"));
  assert.match(lastBotReply(tgCalls) ?? "", /удалены/);

  const userAfter = await dbRows(`select 1 from users where id = '${userId}'`);
  assert.equal(userAfter.length, 0, "user row must be gone");
  const tasksAfter = await dbRows(`select 1 from tasks where user_id = '${userId}'`);
  assert.equal(tasksAfter.length, 0, "cascade must have deleted this user's tasks");
  const missionsAfter = await dbRows(`select 1 from missions where user_id = '${userId}'`);
  assert.equal(missionsAfter.length, 0, "cascade must have deleted this user's missions");
  const publicationsAfter = await dbRows(`select 1 from publications where user_id = '${userId}'`);
  assert.equal(publicationsAfter.length, 0, "cascade must have deleted this user's publications");
});

// --- Task 18: multi-goal /today, cap+pause-frees-slot, per-goal reporting --
// Runs as its own independent chat (CHAT_ID_TWO_GOALS) rather than
// continuing CHAT_ID's story above: by this point CHAT_ID already has a
// plan for "today" with an already-reported/postponed task, and
// handleToday only ever plans missions once per calendar day (see
// buildExistingPlanMessage's early return in today.ts) — a mission added to
// CHAT_ID after today's plan already exists would never get its own task
// planned today. A fresh chat sidesteps that entirely.

test("multi-goal /today: onboard goal #1, /addgoal for goal #2, /today groups one task per goal", async () => {
  await bot.handleUpdate(textUpdate("/start", CHAT_ID_TWO_GOALS));
  const users = await dbRows(`select * from users where telegram_id = '${CHAT_ID_TWO_GOALS}'`);
  assert.equal(users.length, 1);
  userIdTwoGoals = users[0].id;

  await completeOnboardingFlow(CHAT_ID_TWO_GOALS, {
    commitmentText: "Обещаю себе закончить первую цель.",
    goalText: "Запустить свой продукт.",
    programLength: 180,
    directions: ["Создание"],
  });

  let activeMissions = await dbRows(
    `select * from missions where user_id = '${userIdTwoGoals}' and status = 'active' order by created_at asc, id asc`
  );
  assert.equal(activeMissions.length, 1, "goal #1 must be active after onboarding");

  // /addgoal is the new entry point (built in a prior task) for a second
  // goal — same cap-aware startOnboarding as /start, just re-entered while a
  // mission is already active. Below the cap, it must start a fresh Day 0
  // flow, not the cap-reached menu.
  await bot.handleUpdate(textUpdate("/addgoal", CHAT_ID_TWO_GOALS));
  assert.match(
    lastBotReply(tgCalls) ?? "",
    /Дня 0/,
    "/addgoal below the cap must start a fresh onboarding, not the cap menu"
  );

  await completeOnboardingFlow(CHAT_ID_TWO_GOALS, {
    commitmentText: "Обещаю себе бегать по утрам регулярно.",
    goalText: "Начать бегать по утрам.",
    programLength: 365,
    directions: ["Тело"],
  });

  activeMissions = await dbRows(
    `select * from missions where user_id = '${userIdTwoGoals}' and status = 'active' order by created_at asc, id asc`
  );
  assert.equal(activeMissions.length, 2, "must now have two active goals");
  missionOneId = activeMissions[0].id;
  missionTwoId = activeMissions[1].id;

  await bot.handleUpdate(textUpdate("/today", CHAT_ID_TWO_GOALS));
  await bot.handleUpdate(textUpdate("4 3 4 2", CHAT_ID_TWO_GOALS));

  const tasks = await dbRows(
    `select * from tasks where user_id = '${userIdTwoGoals}' and is_main_task = true order by created_at asc`
  );
  assert.equal(tasks.length, 2, "one main task must be planned per active goal, not one for the whole plan");
  const taskMissionIds = tasks.map((t: any) => t.mission_id).sort();
  assert.deepEqual(
    taskMissionIds,
    [missionOneId, missionTwoId].sort(),
    "each task must be attributed to a distinct active mission"
  );

  const reply = lastBotReply(tgCalls) ?? "";
  const goalMarkers = reply.match(/🎯/g) ?? [];
  assert.equal(goalMarkers.length, 2, "the /today reply must render one grouped block per goal");
});

test("report scenario: reporting the SECOND goal's task records it against that goal's mission_id", async () => {
  const missionTwoTasks = await dbRows(
    `select * from tasks where user_id = '${userIdTwoGoals}' and mission_id = '${missionTwoId}' and is_main_task = true`
  );
  assert.equal(missionTwoTasks.length, 1, "goal #2 must have its own main task from the grouped /today plan above");
  const missionTwoTaskId = missionTwoTasks[0].id;

  // Report against the SECOND goal's task, not the first/"primary" one.
  await bot.handleUpdate(callbackUpdate(`report:${missionTwoTaskId}`, CHAT_ID_TWO_GOALS));
  await bot.handleUpdate(textUpdate("Пробежал утром, план на сегодня выполнен.", CHAT_ID_TWO_GOALS));

  const evidences = await dbRows(
    `select * from evidences where user_id = '${userIdTwoGoals}' and task_id = '${missionTwoTaskId}'`
  );
  assert.equal(evidences.length, 1, "the report must be accepted and recorded as evidence for the second goal's task");

  const taskAfter = await dbRows(`select * from tasks where id = '${missionTwoTaskId}'`);
  assert.equal(
    taskAfter[0].mission_id,
    missionTwoId,
    "the reported task must stay attributed to the second (non-primary) goal's mission_id"
  );
  assert.ok(
    ["done", "partially_done"].includes(taskAfter[0].status),
    "the AI reviewer's completion percent must have updated the second goal's task status"
  );

  // The FIRST goal's task must be entirely unaffected by a report filed
  // against the second goal's task.
  const missionOneTasks = await dbRows(
    `select * from tasks where user_id = '${userIdTwoGoals}' and mission_id = '${missionOneId}' and is_main_task = true`
  );
  assert.equal(missionOneTasks.length, 1);
  assert.equal(
    missionOneTasks[0].status,
    "planned",
    "the first goal's task must be untouched by a report filed against the second goal's task"
  );
});

test("cap scenario: 6th goal attempt shows Завершить/Отложить menu; pausing one frees a slot", async () => {
  await bot.handleUpdate(textUpdate("/start", CHAT_ID_CAP));
  const users = await dbRows(`select * from users where telegram_id = '${CHAT_ID_CAP}'`);
  assert.equal(users.length, 1);
  const userIdCap = users[0].id;

  for (let i = 1; i <= MAX_ACTIVE_MISSIONS; i++) {
    if (i > 1) {
      await bot.handleUpdate(textUpdate("/addgoal", CHAT_ID_CAP));
    }
    await completeOnboardingFlow(CHAT_ID_CAP, {
      commitmentText: `Обещаю себе довести цель номер ${i} до конца.`,
      goalText: `Цель номер ${i}.`,
      programLength: 180,
      directions: ["Создание"],
    });
  }

  let activeMissions = await dbRows(
    `select * from missions where user_id = '${userIdCap}' and status = 'active' order by created_at asc, id asc`
  );
  assert.equal(activeMissions.length, MAX_ACTIVE_MISSIONS, "must be sitting exactly at the cap after 5 goals");

  // A 6th attempt must refuse with the cap-reached menu, not a dead end.
  await bot.handleUpdate(textUpdate("/addgoal", CHAT_ID_CAP));
  assert.match(lastBotReply(tgCalls) ?? "", /максимум/i);

  const capMenuCall = tgCalls.filter((c) => c.method === "sendMessage").slice(-1)[0];
  const capKeyboard = (capMenuCall?.payload.reply_markup as any)?.inline_keyboard as
    | { text: string; callback_data: string }[][]
    | undefined;
  assert.ok(capKeyboard, "the refusal must include an inline keyboard, not leave the user at a dead end");
  const capButtons = capKeyboard.flat();
  assert.equal(
    capButtons.length,
    MAX_ACTIVE_MISSIONS * 2,
    "one Завершить + one Отложить button per active mission"
  );
  assert.ok(capButtons.every((b) => /^(Завершить|Отложить): /.test(b.text)));

  const missionToPause = activeMissions[0];
  const pauseButton = capButtons.find((b) => b.callback_data === `mission_pause:${missionToPause.id}`);
  assert.ok(pauseButton, "menu must include an Отложить button targeting the mission we're about to pause");

  // Pick "Отложить" on one of the active missions.
  await bot.handleUpdate(callbackUpdate(`mission_pause:${missionToPause.id}`, CHAT_ID_CAP));
  assert.match(lastBotReply(tgCalls) ?? "", /отложена/);

  const missionAfterPause = await dbRows(`select status from missions where id = '${missionToPause.id}'`);
  assert.equal(missionAfterPause[0].status, "paused");

  activeMissions = await dbRows(`select * from missions where user_id = '${userIdCap}' and status = 'active'`);
  assert.equal(activeMissions.length, MAX_ACTIVE_MISSIONS - 1, "pausing one goal must free a slot");

  // The freed slot must actually be usable: a 6th active goal can now be added.
  await bot.handleUpdate(textUpdate("/addgoal", CHAT_ID_CAP));
  assert.match(
    lastBotReply(tgCalls) ?? "",
    /Дня 0/,
    "with a slot free, /addgoal must start onboarding again, not the cap menu"
  );
  await completeOnboardingFlow(CHAT_ID_CAP, {
    commitmentText: "Обещаю себе довести новую цель до конца.",
    goalText: "Новая цель после освобождения слота.",
    programLength: 180,
    directions: ["Смелость"],
  });

  activeMissions = await dbRows(`select * from missions where user_id = '${userIdCap}' and status = 'active'`);
  assert.equal(
    activeMissions.length,
    MAX_ACTIVE_MISSIONS,
    "the newly added goal must bring the user back to exactly the cap"
  );
});
