import pg from "pg";

// node-postgres parses SQL `date` columns (OID 1082) into JS Date objects
// by default. This codebase treats every date column (day0_date,
// daily_plans.date, etc.) as a plain "YYYY-MM-DD" string with no time or
// timezone component — dayNumberFor() does `${day0Date}T00:00:00Z` string
// interpolation, which silently produces garbage (and then NaN) if
// day0Date is actually a Date object, since template-literal interpolation
// calls Date.prototype.toString(), not toISOString(). Confirmed via a real
// end-to-end test that this was live: a freshly created user's day0_date
// came back as a Date, and any call computing a day number from it
// (bot /today, web /api/today, /api/mentor, the morning/evening cron jobs)
// would throw "invalid input syntax for type integer: NaN" downstream.
// Registering this parser once, globally, at module load, fixes it at the
// source instead of requiring every call site to defensively re-stringify.
pg.types.setTypeParser(1082 /* date */, (val) => val);

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/** Closes the shared pool — used by tests to release connections before dropping a test database, and available for graceful process shutdown generally. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Runs `fn` with a dedicated client whose session has
 * `app.current_user_id` set, so RLS policies (see migrations/002_rls.sql)
 * scope every query in `fn` to that user automatically.
 *
 * This wraps everything in an explicit transaction. That is not optional:
 * set_config(..., is_local=true) only stays in effect for the current
 * transaction. Outside an explicit BEGIN, PostgreSQL auto-commits each
 * statement as its own transaction, so a bare
 * `client.query(set_config); client.query(actual query)` — two separate
 * statements — silently loses the setting before the second query runs,
 * and current_setting() falls back to NULL. Because the RLS policies
 * compare `user_id = current_setting(...)`, a NULL comparison excludes
 * every row rather than erroring, so this fails closed (empty results)
 * rather than leaking data — but it means the app is non-functional under
 * a properly RLS-enforced role, silently. The COMMIT/ROLLBACK here also
 * guarantees the setting can't leak into the next query that happens to
 * reuse this pooled connection.
 *
 * Always use this instead of `getPool().query(...)` directly for anything
 * that touches user-owned tables.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * For operations that legitimately need to run before a user_id exists yet
 * (e.g. looking up or creating a user by telegram_id at /start). This is
 * the one path in the codebase that requires the Postgres role behind
 * DATABASE_URL to have BYPASSRLS — see migrations/002_rls.sql. Everywhere
 * else, use withUserContext so RLS enforces isolation even if application
 * code has a bug. Keep this function's call sites limited to auth/user
 * bootstrap; do not use it as a shortcut to skip RLS elsewhere.
 */
export async function withSystemContext<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
