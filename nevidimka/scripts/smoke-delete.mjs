import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import * as db from "@nevidimka/db";
const state = JSON.parse(await readFile(join(process.env.VIDEO_STORAGE_ROOT, "smoke-state.json"), "utf8"));
const base = "http://web:3000";
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/today`, { signal: AbortSignal.timeout(2000) })).status === 401) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(ready, "production web must start and reject anonymous requests");
  const enc = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const tokenFor = telegramId => {
    const data = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ userId: state.userId, telegramId, exp: Math.floor(Date.now()/1000)+300 })}`;
    return `${data}.${createHmac("sha256", process.env.JWT_SECRET).update(data).digest("base64url")}`;
  };
  const request = async (confirm, telegramId = process.env.OWNER_TELEGRAM_ID, site = "same-origin") => fetch(`${base}/api/settings/delete`, {
    method: "POST", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/json", "sec-fetch-site": site, cookie: `nevidimka_session=${tokenFor(telegramId)}` }, body: JSON.stringify({ confirm }),
  });
  assert.equal((await request("DELETE", "700111223")).status, 401, "non-owner session must be rejected");
  assert.equal((await request("DELETE", undefined, "cross-site")).status, 403);
  assert.equal((await request("wrong")).status, 400);
  await db.updateVideoAssetStatus(state.userId, state.assetId, "processing");
  assert.equal((await request("DELETE")).status, 409);
  await access(state.original);
  await db.updateVideoAssetStatus(state.userId, state.assetId, "failed");
  const response = await request("DELETE");
  assert.equal(response.status, 200, await response.text());
  for (const path of [state.evidence, state.original, state.work]) await assert.rejects(access(path), { code: "ENOENT" });
  await access(join(process.env.VIDEO_STORAGE_ROOT, "other-user.txt"));
  assert.equal(await db.getUserById(state.userId), null);
  assert.ok(await db.getUserById(state.otherId), "other account must survive");
} finally { await db.closePool(); }
