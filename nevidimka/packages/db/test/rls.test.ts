// Regression test for AUDIT_REPORT.md's most critical finding: a
// transaction-scoping bug in withUserContext meant RLS silently never
// applied, and every prior manual test missed it because testing always
// happened as a Postgres superuser (which bypasses RLS regardless). This
// test deliberately runs as a non-superuser role — the same posture a real
// deployment should use — and attacks cross-user access directly.
//
// Run: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/rls.test.ts
// (DATABASE_URL here must be a superuser connection — the test creates its
// own restricted role and a throwaway database to test against.)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_rls_test";
const APP_ROLE = "nevidimka_rls_app_role";
const SYSTEM_ROLE = "nevidimka_rls_system_role";
const APP_PASSWORD = "test-only-password";
const SYSTEM_PASSWORD = "test-only-system-password";

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}
function urlForRole(role: string, password: string): string {
  const u = new URL(urlForDb(TEST_DB));
  u.username = role;
  u.password = password;
  return u.toString();
}

let db: typeof import("../dist/index.js");

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  // Apply every migration, in order, exactly as production does.
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const migrationsDir = join(import.meta.dirname, "..", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const dbAdmin = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  await dbAdmin.connect();
  for (const file of files) {
    await dbAdmin.query(readFileSync(join(migrationsDir, file), "utf8"));
  }

  // DATABASE_URL is a genuinely restricted application role. Privileged
  // bootstrap and cross-user jobs use a separate SYSTEM_DATABASE_URL role.
  await dbAdmin.query(`drop role if exists ${APP_ROLE}`);
  await dbAdmin.query(`drop role if exists ${SYSTEM_ROLE}`);
  await dbAdmin.query(`create role ${APP_ROLE} login password '${APP_PASSWORD}' nosuperuser nobypassrls`);
  await dbAdmin.query(`create role ${SYSTEM_ROLE} login password '${SYSTEM_PASSWORD}' nosuperuser bypassrls`);
  for (const role of [APP_ROLE, SYSTEM_ROLE]) {
    await dbAdmin.query(`grant usage on schema public to ${role}`);
    await dbAdmin.query(`grant select, insert, update, delete on all tables in schema public to ${role}`);
    await dbAdmin.query(`grant usage, select on all sequences in schema public to ${role}`);
  }
  await dbAdmin.end();

  process.env.DATABASE_URL = urlForRole(APP_ROLE, APP_PASSWORD);
  process.env.SYSTEM_DATABASE_URL = urlForRole(SYSTEM_ROLE, SYSTEM_PASSWORD);
  db = await import("../dist/index.js");
});

after(async () => {
  await db.closePool();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`drop role if exists ${APP_ROLE}`);
  await admin.query(`drop role if exists ${SYSTEM_ROLE}`);
  await admin.end();
});

test("two users cannot see each other's data under a real non-superuser RLS-enforced role", async () => {
  const userA = await db.getOrCreateUser({ telegramId: "rls-test-a" });
  const userB = await db.getOrCreateUser({ telegramId: "rls-test-b" });

  const missionA = await db.createMission({
    userId: userA.id, title: "Mission A", description: "d",
    directions: ["Создание"], commitmentText: "c",
  });
  const missionB = await db.createMission({
    userId: userB.id, title: "Mission B", description: "d",
    directions: ["Тело"], commitmentText: "c",
  });

  const planA = await db.getOrCreateTodayPlan(userA.id, "2026-01-01", 1);
  const planB = await db.getOrCreateTodayPlan(userB.id, "2026-01-01", 1);
  const taskA = await db.createTask({ userId: userA.id, dailyPlanId: planA.id, title: "Secret A", isMainTask: true });
  const taskB = await db.createTask({ userId: userB.id, dailyPlanId: planB.id, title: "Secret B", isMainTask: true });
  await db.addIdea(userA.id, "Idea A");
  await db.addIdea(userB.id, "Idea B");

  // Basic read isolation
  assert.equal((await db.getActiveMission(userA.id))?.title, "Mission A");
  assert.equal((await db.getActiveMission(userB.id))?.title, "Mission B");
  assert.ok(!(await db.listInboxIdeas(userA.id)).some((i) => i.text === "Idea B"));
  assert.ok(!(await db.listInboxIdeas(userB.id)).some((i) => i.text === "Idea A"));

  // Direct attacks: A tries to act on B's rows using B's real IDs
  await db.saveCheckIn(userA.id, planB.id, { sleepQuality: 1, energy: 1, mood: 1, stress: 5 });
  const planBAfter = await db.getOrCreateTodayPlan(userB.id, "2026-01-01", 1);
  assert.notEqual(planBAfter.checkIn?.sleepQuality, 1, "user A must not be able to modify user B's daily plan");

  await db.setPlanAiSummary(userA.id, planB.id, "HACKED");
  const planBAfter2 = await db.getOrCreateTodayPlan(userB.id, "2026-01-01", 1);
  assert.notEqual(planBAfter2.aiSummary, "HACKED", "user A must not be able to set user B's AI summary");

  await assert.rejects(
    () => db.createMilestone({ userId: userA.id, missionId: missionB.id, title: "HACKED", targetDay: 1 }),
    /not found or not owned/,
    "user A must not be able to create a milestone under user B's mission"
  );

  const tasksBSeenByA = await db.listTasksForPlan(userA.id, planB.id);
  assert.equal(tasksBSeenByA.length, 0, "user A must not be able to list user B's tasks by guessing the plan id");

  // Sanity: legitimate same-user operations still work after all this
  await db.saveCheckIn(userB.id, planB.id, { sleepQuality: 4, energy: 4, mood: 4, stress: 2 });
  const planBLegit = await db.getOrCreateTodayPlan(userB.id, "2026-01-01", 1);
  assert.equal(planBLegit.checkIn?.sleepQuality, 4, "user B's own legitimate update must still work");

  void taskA;
  void taskB;
});
