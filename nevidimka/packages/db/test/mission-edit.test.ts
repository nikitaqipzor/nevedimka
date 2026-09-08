// Tests for editing a mission and its milestones from the Mini App.
//
// Context: PROJECT_SPEC.md section 20's Release 2 criterion requires that
// everything the bot collects is "видны И РЕДАКТИРУЕМЫ в Mini App". Missions
// were read-only in the web app — the only way to start or change a path was
// the bot's /start conversation. updateMission / replaceMilestones /
// setDay0Date are the repository half of closing that gap; apps/web's
// /api/path POST is the HTTP half.
//
// The properties worth pinning down here are the ones a careless future edit
// would break silently: partial patching (don't wipe fields you didn't
// send), cross-user isolation (RLS plus an explicit user_id predicate), and
// milestone replacement being atomic rather than delete-then-fail.
//
// Run: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/mission-edit.test.ts
// (DATABASE_URL must be a superuser connection — this creates a throwaway db.)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_mission_edit_test";

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

let db: typeof import("../dist/index.js");
let userId: string;
let otherUserId: string;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const migrationsDir = join(import.meta.dirname, "..", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const dbAdmin = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  await dbAdmin.connect();
  for (const file of files) {
    await dbAdmin.query(readFileSync(join(migrationsDir, file), "utf8"));
  }
  await dbAdmin.end();

  process.env.DATABASE_URL = urlForDb(TEST_DB);
  db = await import("../dist/index.js");

  userId = (await db.getOrCreateUser({ telegramId: "mission-edit-owner" })).id;
  otherUserId = (await db.getOrCreateUser({ telegramId: "mission-edit-stranger" })).id;
});

after(async () => {
  await db.closePool();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.end();
});

async function freshMission(owner = userId) {
  // One active mission per user is a DB invariant (migration 008), so an
  // existing one has to be retired before a test can create another.
  const existing = await db.getActiveMission(owner);
  if (existing) {
    const pool = db.getPool();
    await pool.query("update missions set status = 'abandoned' where id = $1", [existing.id]);
  }
  return db.createMission({
    userId: owner,
    title: "Исходная миссия",
    description: "Исходное описание",
    directions: ["Создание", "Тело"],
    commitmentText: "Исходный договор",
  });
}

// --- partial patching ----------------------------------------------------

test("patching only the title leaves every other field untouched", async () => {
  const mission = await freshMission();

  const updated = await db.updateMission(userId, mission.id, { title: "Новое название" });

  assert.equal(updated?.title, "Новое название");
  assert.equal(updated?.description, "Исходное описание", "description must survive");
  assert.deepEqual(updated?.directions, ["Создание", "Тело"], "directions must survive");
  assert.equal(updated?.commitmentText, "Исходный договор", "commitment must survive");
});

test("patching only the commitment leaves the title alone", async () => {
  const mission = await freshMission();

  const updated = await db.updateMission(userId, mission.id, {
    commitmentText: "Только договор изменился",
  });

  assert.equal(updated?.commitmentText, "Только договор изменился");
  assert.equal(updated?.title, "Исходная миссия");
});

test("directions can be replaced wholesale, including shrinking the list", async () => {
  const mission = await freshMission();

  const updated = await db.updateMission(userId, mission.id, { directions: ["Смелость"] });

  assert.deepEqual(updated?.directions, ["Смелость"]);
});

test("description can be cleared with null, distinct from not sending it", async () => {
  const mission = await freshMission();

  // Explicit null clears; the route maps an empty string to this.
  const cleared = await db.updateMission(userId, mission.id, { description: null });
  assert.equal(cleared?.description, undefined, "cleared description reads back as undefined");

  // A later patch that omits description must not resurrect the old value
  // nor fail — it just leaves the NULL in place.
  const after = await db.updateMission(userId, mission.id, { title: "Ещё раз" });
  assert.equal(after?.description, undefined);
  assert.equal(after?.title, "Ещё раз");
});

test("an empty patch is a no-op, not a wipe", async () => {
  const mission = await freshMission();

  const updated = await db.updateMission(userId, mission.id, {});

  assert.equal(updated?.title, "Исходная миссия");
  assert.equal(updated?.description, "Исходное описание");
  assert.deepEqual(updated?.directions, ["Создание", "Тело"]);
  assert.equal(updated?.commitmentText, "Исходный договор");
});

// --- cross-user isolation ------------------------------------------------

test("one user cannot patch another user's mission", async () => {
  const mine = await freshMission();

  const result = await db.updateMission(otherUserId, mine.id, { title: "Захвачено" });

  assert.equal(result, null, "the update must match no rows");
  const unchanged = await db.getActiveMission(userId);
  assert.equal(unchanged?.title, "Исходная миссия", "the real owner's data must be intact");
});

test("one user cannot replace another user's milestones", async () => {
  const mine = await freshMission();
  await db.createMilestone({ userId, missionId: mine.id, title: "Мой этап", targetDay: 30 });

  const result = await db.replaceMilestones(otherUserId, mine.id, [
    { title: "Подменённый", targetDay: 5 },
  ]);

  assert.deepEqual(result, [], "ownership check must reject before deleting anything");
  const still = await db.listMilestones(userId, mine.id);
  assert.equal(still.length, 1, "the owner's milestone must still be there");
  assert.equal(still[0].title, "Мой этап");
});

// --- milestone replacement ----------------------------------------------

test("replaceMilestones swaps the whole list and returns it sorted by day", async () => {
  const mission = await freshMission();
  await db.createMilestone({ userId, missionId: mission.id, title: "Старый A", targetDay: 10 });
  await db.createMilestone({ userId, missionId: mission.id, title: "Старый B", targetDay: 20 });

  // Deliberately out of order on the way in: the Path screen lets a user type
  // days in any order, and the timeline must not depend on that.
  const result = await db.replaceMilestones(userId, mission.id, [
    { title: "Третий", targetDay: 180 },
    { title: "Первый", targetDay: 30 },
    { title: "Второй", targetDay: 90 },
  ]);

  assert.deepEqual(
    result.map((m) => [m.targetDay, m.title]),
    [
      [30, "Первый"],
      [90, "Второй"],
      [180, "Третий"],
    ]
  );

  const reread = await db.listMilestones(userId, mission.id);
  assert.equal(reread.length, 3, "old milestones must be gone, not appended to");
});

test("replaceMilestones can reduce the list to a single entry", async () => {
  const mission = await freshMission();
  await db.createMilestone({ userId, missionId: mission.id, title: "A", targetDay: 10 });
  await db.createMilestone({ userId, missionId: mission.id, title: "B", targetDay: 20 });
  await db.createMilestone({ userId, missionId: mission.id, title: "C", targetDay: 30 });

  const result = await db.replaceMilestones(userId, mission.id, [
    { title: "Только один", targetDay: 60 },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Только один");
});

test("replacing with an unknown mission id changes nothing anywhere", async () => {
  const mission = await freshMission();
  await db.createMilestone({ userId, missionId: mission.id, title: "Живой этап", targetDay: 45 });

  const result = await db.replaceMilestones(
    userId,
    "00000000-0000-0000-0000-000000000000",
    [{ title: "Ничего", targetDay: 1 }]
  );

  assert.deepEqual(result, []);
  const still = await db.listMilestones(userId, mission.id);
  assert.equal(still.length, 1, "an unrelated mission's milestones must be untouched");
});

// --- day 0 ---------------------------------------------------------------

test("setDay0Date changes where the program counts from", async () => {
  await db.setDay0Date(userId, "2026-01-15");

  const user = await db.getUserById(userId);
  assert.equal(user?.day0Date, "2026-01-15");

  // Guards the pg date parser registered in src/client.ts: if day0_date came
  // back as a Date object instead of a string, every day-number calculation
  // downstream would produce NaN.
  assert.equal(typeof user?.day0Date, "string", "day0_date must read back as a plain string");
});

test("setDay0Date on one user does not touch another", async () => {
  await db.setDay0Date(userId, "2026-02-01");
  await db.setDay0Date(otherUserId, "2026-03-01");

  assert.equal((await db.getUserById(userId))?.day0Date, "2026-02-01");
  assert.equal((await db.getUserById(otherUserId))?.day0Date, "2026-03-01");
});

// --- the one-active-mission invariant -----------------------------------

test("a second active mission for the same user is refused by the database", async () => {
  await freshMission();

  await assert.rejects(
    () =>
      db.createMission({
        userId,
        title: "Вторая активная",
        directions: ["X"],
        commitmentText: "y",
      }),
    (err: { code?: string }) => err.code === "23505",
    "must fail with unique_violation (uq_missions_one_active_per_user, migration 008)"
  );
});
