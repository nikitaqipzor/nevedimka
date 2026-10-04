// Full user-journey test through the real bot (onboarding → daily cycle →
// focus → coach → report → ideas → evening → text publication →
// idempotency check). Run:
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/full-flow.test.ts
// (DATABASE_URL must be a superuser connection — the test creates and
// drops its own throwaway database.)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { startMockAnthropic } from "./mock-anthropic.js";
import { startMockTelegram, lastBotReply, type MockTelegramCall } from "./mock-telegram.js";

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
let evidenceStorageRoot: string;
let videoStorageRoot: string;

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
  process.env.OWNER_TELEGRAM_ID = String(CHAT_ID);
  evidenceStorageRoot = await mkdtemp(join(tmpdir(), "nevidimka-full-flow-evidence-"));
  videoStorageRoot = await mkdtemp(join(tmpdir(), "nevidimka-full-flow-video-"));
  process.env.EVIDENCE_STORAGE_ROOT = evidenceStorageRoot;
  process.env.VIDEO_STORAGE_ROOT = videoStorageRoot;
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
  await rm(evidenceStorageRoot, { recursive: true, force: true });
  await rm(videoStorageRoot, { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.end();
});

test("non-owner update cannot create an account", async () => {
  const update = textUpdate("/start");
  update.message!.from!.id = CHAT_ID + 1;
  await bot.handleUpdate(update);
  const rows = await dbRows(`select 1 from users where telegram_id = '${CHAT_ID + 1}'`);
  assert.equal(rows.length, 0);
});

test("onboarding: /start creates a user and shows Day 0", async () => {
  await bot.handleUpdate(textUpdate("/start"));
  const users = await dbRows(`select *, day0_date = (created_at at time zone timezone)::date as starts_on_local_date from users where telegram_id = '${CHAT_ID}'`);
  assert.equal(users.length, 1);
  userId = users[0].id;
  assert.equal(users[0].starts_on_local_date, true, "new account must start on its local calendar date");
  assert.match(lastBotReply(tgCalls) ?? "", /Дня 0/);
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

test("/export sends a document containing this user's real data", async () => {
  await bot.handleUpdate(textUpdate("/export"));
  const doc = tgCalls.find((c) => c.method === "sendDocument");
  assert.ok(doc, "bot must send a document in response to /export");
});

test("/delete: wrong confirmation text cancels, correct text deletes everything (cascade)", async () => {
  const evidencePath = join(evidenceStorageRoot, "account-evidence.ogg");
  const uploadDirectory = join(videoStorageRoot, "uploads");
  const originalVideoPath = join(uploadDirectory, "original.mp4");
  await writeFile(evidencePath, "private evidence");
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(originalVideoPath, "original video");
  await db.addEvidence({ userId, kind: "voice", storagePath: evidencePath });
  const videoAsset = await db.createVideoAsset({
    userId,
    originalStoragePath: originalVideoPath,
  });
  const videoWorkDirectory = join(videoStorageRoot, videoAsset.id, "work");
  const masterVideoPath = join(videoWorkDirectory, "master.mp4");
  await mkdir(videoWorkDirectory, { recursive: true });
  await writeFile(masterVideoPath, "processed video");

  await bot.handleUpdate(textUpdate("/delete"));
  assert.match(lastBotReply(tgCalls) ?? "", /необратимо/i);

  // Wrong confirmation: must NOT delete anything
  await bot.handleUpdate(textUpdate("yes please"));
  assert.match(lastBotReply(tgCalls) ?? "", /Отменено/);
  let stillThere = await dbRows(`select 1 from users where id = '${userId}'`);
  assert.equal(stillThere.length, 1, "wrong confirmation text must not delete the account");
  await access(evidencePath);
  await access(originalVideoPath);
  await access(masterVideoPath);

  // Active video work: fail closed so the worker cannot recreate files after cleanup.
  await db.updateVideoAssetStatus(userId, videoAsset.id, "processing");
  await bot.handleUpdate(textUpdate("/delete"));
  await bot.handleUpdate(textUpdate("DELETE"));
  assert.match(lastBotReply(tgCalls) ?? "", /ещё обрабатывается/i);
  stillThere = await dbRows(`select 1 from users where id = '${userId}'`);
  assert.equal(stillThere.length, 1, "active video processing must postpone account deletion");
  await access(masterVideoPath);
  await db.updateVideoAssetStatus(userId, videoAsset.id, "failed");

  // Correct confirmation after processing stops: delete the user and every owned resource.
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
  await assert.rejects(access(evidencePath), "account deletion must remove owned evidence files");
  await assert.rejects(access(originalVideoPath), "account deletion must remove original videos");
  await assert.rejects(access(masterVideoPath), "account deletion must remove video work directories");
});
