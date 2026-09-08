import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolveDatabaseUrls } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const DOWN_DIR = join(MIGRATIONS_DIR, "down");

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function up(client: pg.Client): Promise<void> {
  await ensureMigrationsTable(client);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await client.query<{ filename: string }>(
    "select filename from schema_migrations"
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`apply ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  console.log("Migrations up to date.");
}

/**
 * Rolls back the `steps` most recently applied migrations, in reverse
 * order, using the matching file in migrations/down/. Each down file must
 * have the exact same filename as the forward migration it reverses.
 */
async function down(client: pg.Client, steps: number): Promise<void> {
  await ensureMigrationsTable(client);

  const { rows: applied } = await client.query<{ filename: string }>(
    "select filename from schema_migrations order by applied_at desc limit $1",
    [steps]
  );

  if (applied.length === 0) {
    console.log("Nothing to roll back.");
    return;
  }

  for (const { filename } of applied) {
    const downPath = join(DOWN_DIR, filename);
    if (!existsSync(downPath)) {
      throw new Error(
        `No down migration found for ${filename} (expected ${downPath}). Refusing to leave the migration log inconsistent with the schema — write the down file first.`
      );
    }
    const sql = readFileSync(downPath, "utf8");
    console.log(`revert ${filename}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("delete from schema_migrations where filename = $1", [filename]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Rolling back ${filename} failed: ${(err as Error).message}`);
    }
  }

  console.log(`Rolled back ${applied.length} migration(s).`);
}

async function main(): Promise<void> {
  const { system: connectionString } = resolveDatabaseUrls();

  const [command, arg] = process.argv.slice(2);

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    if (command === "down") {
      const steps = arg ? Number(arg) : 1;
      if (!Number.isInteger(steps) || steps < 1) {
        throw new Error(`Invalid step count: ${arg}`);
      }
      await down(client, steps);
    } else if (command === undefined) {
      await up(client);
    } else {
      throw new Error(`Unknown command: ${command}. Usage: migrate [down [n]]`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
