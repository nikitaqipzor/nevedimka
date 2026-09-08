import pg from "pg";
import { resolveDatabaseUrls } from "./config.js";

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

let userPool: pg.Pool | undefined;
let systemPool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!userPool) {
    const { user } = resolveDatabaseUrls();
    userPool = new Pool({ connectionString: user });
  }
  return userPool;
}

export function getSystemPool(): pg.Pool {
  const { user, system } = resolveDatabaseUrls();
  if (system === user) {
    return getPool();
  }
  if (!systemPool) {
    systemPool = new Pool({ connectionString: system });
  }
  return systemPool;
}

/** Closes both pools — used by tests and graceful process shutdown. */
export async function closePool(): Promise<void> {
  const pools = [userPool, systemPool].filter(
    (pool, index, all): pool is pg.Pool => Boolean(pool) && all.indexOf(pool) === index
  );
  userPool = undefined;
  systemPool = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
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
 * Uses SYSTEM_DATABASE_URL for the narrowly reviewed cross-user operations
 * needed by auth bootstrap, reminders, and queue claims. DATABASE_URL must
 * remain a NOBYPASSRLS role in production.
 */
export async function withSystemContext<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getSystemPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
