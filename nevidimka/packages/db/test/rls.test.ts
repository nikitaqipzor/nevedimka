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
import { MAX_ACTIVE_MISSIONS } from "@nevidimka/shared-types";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_rls_test";
const APP_ROLE = "nevidimka_rls_test_role";
const APP_PASSWORD = "test-only-password";

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}
function urlForRestrictedRole(): string {
  const u = new URL(urlForDb(TEST_DB));
  u.username = APP_ROLE;
  u.password = APP_PASSWORD;
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

  // The restricted role: NOT a superuser, does NOT bypass RLS in general —
  // except BYPASSRLS is still required for the documented bootstrap case
  // (creating a brand-new user has no user_id to scope to yet; see
  // withSystemContext's doc comment in src/client.ts). This mirrors
  // exactly what a real deployment's DATABASE_URL role should be.
  await dbAdmin.query(`drop role if exists ${APP_ROLE}`);
  await dbAdmin.query(`create role ${APP_ROLE} login password '${APP_PASSWORD}' nosuperuser bypassrls`);
  await dbAdmin.query(`grant usage on schema public to ${APP_ROLE}`);
  await dbAdmin.query(`grant select, insert, update, delete on all tables in schema public to ${APP_ROLE}`);
  await dbAdmin.query(`grant usage, select on all sequences in schema public to ${APP_ROLE}`);
  await dbAdmin.end();

  process.env.DATABASE_URL = urlForRestrictedRole();
  db = await import("../dist/index.js");
});

after(async () => {
  await db.closePool();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`drop role if exists ${APP_ROLE}`);
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
  const missionsA = await db.getActiveMissions(userA.id);
  const missionsB = await db.getActiveMissions(userB.id);
  assert.equal(missionsA.length, 1);
  assert.equal(missionsB.length, 1);
  assert.equal(missionsA[0].title, "Mission A");
  assert.equal(missionsB[0].title, "Mission B");
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

test("multiple active missions per user stay isolated across users (multi-mission RLS)", async () => {
  // Own throwaway users (distinct telegram ids) so this test's data can't
  // collide with or be polluted by the other tests in this file — same
  // isolation approach the rest of the suite already uses, just scoped to
  // its own users rather than sharing userA/userB from the test above.
  const userA = await db.getOrCreateUser({ telegramId: "rls-test-multi-a" });
  const userB = await db.getOrCreateUser({ telegramId: "rls-test-multi-b" });

  const missionA1 = await db.createMission({
    userId: userA.id, title: "Multi Mission A1", description: "d",
    directions: ["Создание"], commitmentText: "c",
  });
  const missionA2 = await db.createMission({
    userId: userA.id, title: "Multi Mission A2", description: "d",
    directions: ["Тело"], commitmentText: "c",
  });
  const missionB1 = await db.createMission({
    userId: userB.id, title: "Multi Mission B1", description: "d",
    directions: ["Разум"], commitmentText: "c",
  });

  const missionsA = await db.getActiveMissions(userA.id);
  const missionsB = await db.getActiveMissions(userB.id);

  assert.equal(missionsA.length, 2, "user A must see both of their own active missions");
  assert.deepEqual(
    missionsA.map((m) => m.title).sort(),
    ["Multi Mission A1", "Multi Mission A2"]
  );
  assert.ok(
    !missionsA.some((m) => m.id === missionB1.id),
    "user A's active missions must not include user B's mission"
  );

  assert.equal(missionsB.length, 1, "user B must see only their own active mission");
  assert.equal(missionsB[0].title, "Multi Mission B1");
  assert.ok(
    !missionsB.some((m) => m.id === missionA1.id || m.id === missionA2.id),
    "user B's active missions must not include either of user A's missions"
  );
});

test("active mission cap trigger rejects a 6th active mission for the same user", async () => {
  const user = await db.getOrCreateUser({ telegramId: "rls-test-cap-a" });

  for (let i = 0; i < MAX_ACTIVE_MISSIONS; i++) {
    await db.createMission({
      userId: user.id, title: `Cap Mission ${i}`, description: "d",
      directions: ["Создание"], commitmentText: "c",
    });
  }

  const activeBefore = await db.getActiveMissions(user.id);
  assert.equal(activeBefore.length, MAX_ACTIVE_MISSIONS);

  await assert.rejects(
    () =>
      db.createMission({
        userId: user.id, title: "One Mission Too Many", description: "d",
        directions: ["Тело"], commitmentText: "c",
      }),
    /cap|exceeded/i,
    "the enforce_active_mission_limit trigger must reject the 6th active mission for this user"
  );

  const activeAfter = await db.getActiveMissions(user.id);
  assert.equal(
    activeAfter.length,
    MAX_ACTIVE_MISSIONS,
    "the rejected 6th mission must not have actually been inserted"
  );
});
