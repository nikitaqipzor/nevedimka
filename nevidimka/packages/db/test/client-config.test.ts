import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveDatabaseUrls } from "../dist/config.js";

test("production requires a dedicated system database URL", () => {
  assert.throws(
    () =>
      resolveDatabaseUrls({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app-role@localhost/nevidimka",
      }),
    /SYSTEM_DATABASE_URL is not set/
  );
});

test("production keeps user and system database URLs separate", () => {
  assert.deepEqual(
    resolveDatabaseUrls({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://app-role@localhost/nevidimka",
      SYSTEM_DATABASE_URL: "postgres://system-role@localhost/nevidimka",
    }),
    {
      user: "postgres://app-role@localhost/nevidimka",
      system: "postgres://system-role@localhost/nevidimka",
    }
  );
});

test("production rejects identical user and system database URLs", () => {
  assert.throws(
    () =>
      resolveDatabaseUrls({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://shared-role@localhost/nevidimka",
        SYSTEM_DATABASE_URL: "postgres://shared-role@localhost/nevidimka",
      }),
    /must use different credentials/
  );
});

test("production rejects the same credentials hidden behind different URL options", () => {
  assert.throws(
    () =>
      resolveDatabaseUrls({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://shared-role:secret@localhost/nevidimka?application_name=user",
        SYSTEM_DATABASE_URL:
          "postgres://shared-role:secret@localhost/nevidimka?application_name=system",
      }),
    /must use different credentials/
  );
});

test("development and tests retain the single-URL fallback", () => {
  assert.deepEqual(
    resolveDatabaseUrls({ DATABASE_URL: "postgres://dev@localhost/nevidimka" }),
    {
      user: "postgres://dev@localhost/nevidimka",
      system: "postgres://dev@localhost/nevidimka",
    }
  );
});
