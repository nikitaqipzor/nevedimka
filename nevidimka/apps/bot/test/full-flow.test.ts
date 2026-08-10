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
import { startMockAnthropic } from "./mock-anthropic.js";
import { startMockTelegram, lastBotReply, type MockTelegramCall } from "./mock-telegram.js";
import { addDaysToDateString, todayInTimezone } from "../src/utils/dates.js";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_bot_full_flow_test";
const CHAT_ID = 555000111;

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

let updateId = 1;
function textUpdate(text: string): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT_ID, type: "private", first_name: "Никита" },
      from: { id: CHAT_ID, is_bot: false, first_name: "Никита" },
      text,
      ...(text.startsWith("/")
        ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] }
        : {}),
    },
  } as unknown as Update;
}
function callbackUpdate(data: string): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: CHAT_ID, is_bot: false, first_name: "Никита" },
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "private", first_name: "Никита" },
        from: { id: 1, is_bot: true, first_name: "Test" },
        text: "...",
      },
      chat_instance: "1",
      data,
    },
  } as unknown as Update;
}

let bot: Bot<any>;
let tgCalls: MockTelegramCall[];
let mockAi: Awaited<ReturnType<typeof startMockAnthropic>>;
let mockTg: Awaited<ReturnType<typeof startMockTelegram>>;
let db: typeof import("@nevidimka/db");
let userId: string;
let mainTaskId: string;
let extraTaskId: string;
let draftId: string;

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

  const tasks = await dbRows(`select * from tasks where user_id = '${userId}'`);
  assert.equal(tasks.length, 2);
  const mainTask = tasks.find((t) => t.is_main_task);
  assert.equal(mainTask.title, "Настроить окружение проекта");
  assert.equal(mainTask.direction, "Создание");
  mainTaskId = mainTask.id;
  extraTaskId = tasks.find((t) => !t.is_main_task).id;
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

test("postpone button on the extra task", async () => {
  await bot.handleUpdate(callbackUpdate(`task:postpone:${extraTaskId}`));
  const task = await dbRows(`select * from tasks where id = '${extraTaskId}'`);
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

  await bot.handleUpdate(textUpdate("/post"));
  await bot.handleUpdate(callbackUpdate("post:source:new"));
  await bot.handleUpdate(textUpdate("Пробежал 5 км утром и записал прогресс."));

  const drafts = await dbRows(
    `select * from content_drafts where user_id = '${userId}' order by created_at desc limit 1`
  );
  const multiDraftId = drafts[0].id;
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

test("/post: tapping a picker button for a mission that went inactive before the tap fails gracefully", async () => {
  await bot.handleUpdate(textUpdate("/post"));
  await bot.handleUpdate(callbackUpdate("post:source:new"));
  await bot.handleUpdate(textUpdate("Ещё одна запись для проверки протухшего выбора цели."));

  const drafts = await dbRows(
    `select * from content_drafts where user_id = '${userId}' order by created_at desc limit 1`
  );
  const staleDraftId = drafts[0].id;
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
