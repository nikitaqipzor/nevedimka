// Regression test for the migration/rollback system itself. Verifies:
//   1. every forward migration has a matching down file
//   2. applying all migrations, then rolling every one of them back,
//      leaves only the schema_migrations bookkeeping table
//   3. re-applying from that rolled-back state reproduces the exact same
//      table set as a fresh migrate run
//   4. multi-step rollback (`down N`) reverts N migrations in one call
//
// This is the exact manual sequence that was run by hand during
// development (see README.md) — now permanent, so a future migration
// added without a down file (or a down file that drifts out of sync)
// fails CI instead of being discovered manually, later, under pressure.
//
// Run: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/migrations.test.ts

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_migrations_test";
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
const DOWN_DIR = join(MIGRATIONS_DIR, "down");
const MIGRATE_SCRIPT = join(import.meta.dirname, "..", "dist", "migrate.js");

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function runMigrate(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("node", [MIGRATE_SCRIPT, ...args], {
    env: { ...process.env, DATABASE_URL: urlForDb(TEST_DB) },
  });
  return stdout;
}

async function tableNames(): Promise<string[]> {
  const client = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  await client.connect();
  const r = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  );
  await client.end();
  return r.rows.map((row) => row.tablename);
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB}`);
  await admin.end();
});

test("every forward migration has a matching down file", () => {
  const forward = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  assert.ok(forward.length > 0, "expected at least one migration file");
  for (const file of forward) {
    assert.ok(
      existsSync(join(DOWN_DIR, file)),
      `missing down migration for ${file} — every forward migration must have a matching migrations/down/${file}`
    );
  }
});

test("full round trip: up -> down all -> up again reproduces the same schema", async () => {
  await runMigrate([]);
  const afterFirstUp = await tableNames();
  assert.ok(afterFirstUp.includes("users"), "expected core tables after first up");

  const forwardCount = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length;
  await runMigrate(["down", String(forwardCount)]);
  const afterFullDown = await tableNames();
  assert.deepEqual(
    afterFullDown,
    ["schema_migrations"],
    "after rolling back every migration, only the bookkeeping table should remain"
  );

  await runMigrate([]);
  const afterSecondUp = await tableNames();
  assert.deepEqual(afterSecondUp, afterFirstUp, "re-applying from empty must reproduce the exact same table set");
});

test("multi-step down (N > 1) rolls back exactly the N most recently applied migrations, in order", async () => {
  // Picks up right where the previous test left off (fully migrated).
  // Deliberately checks this against schema_migrations (the bookkeeping
  // table) rather than asserting which specific tables specific
  // migrations create — a hardcoded "005 removes video_assets, 004
  // removes content_drafts" version of this test broke twice already as
  // new migrations were added that only altered columns (no new table).
  // This version stays correct regardless of what future migrations do.
  const allFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const N = 2;
  const expectedRemaining = allFiles.slice(0, allFiles.length - N);
  const expectedRolledBack = allFiles.slice(allFiles.length - N);

  await runMigrate(["down", String(N)]);

  const client = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  await client.connect();
  const applied = await client.query<{ filename: string }>("select filename from schema_migrations order by filename");
  await client.end();
  const appliedFiles = applied.rows.map((r) => r.filename);

  assert.deepEqual(appliedFiles, expectedRemaining, "exactly the N most recent migrations must be rolled back, earlier ones untouched");
  for (const f of expectedRolledBack) {
    assert.ok(!appliedFiles.includes(f), `${f} should have been rolled back`);
  }

  // Restore full schema for cleanliness (not strictly required, after() drops the DB anyway).
  await runMigrate([]);
});
