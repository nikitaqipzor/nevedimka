// End-to-end test for the Mini App, in a real browser. Run:
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/e2e.test.ts
// (DATABASE_URL must be a superuser connection — the test creates and
// drops its own throwaway database.) Requires Chromium; if not already
// present, `npx playwright install --with-deps chromium` first.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import pg from "pg";
import { startMockAnthropic } from "./mock-anthropic.js";
import { startMockTelegram } from "./mock-telegram.js";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_web_e2e_test";
const WEB_PORT = 3947;
const BASE = `http://localhost:${WEB_PORT}`;
const OWNER_TELEGRAM_ID = "700111222";

function urlForDb(dbName: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

let devServer: ChildProcess;
let browser: Browser;
let page: Page;
let mockAi: Awaited<ReturnType<typeof startMockAnthropic>>;
let mockTg: Awaited<ReturnType<typeof startMockTelegram>>;
let videoAssetId: string;
let publicationId: string;
const pageErrors: string[] = [];

async function waitForText(p: Page, substring: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await p.textContent("body").catch(() => "");
    if (text?.includes(substring)) return true;
    await p.waitForTimeout(150);
  }
  return false;
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server at ${url} did not become ready within ${timeoutMs}ms`);
}

/**
 * next dev compiles each route on first request, which can comfortably
 * blow past a tight per-assertion timeout the first time Playwright visits
 * it. Fetching every route once up front (sequentially, so compiles don't
 * contend with each other) means by the time the browser test starts
 * clicking, everything is already warm.
 */
async function warmUpRoutes(base: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    await fetch(`${base}${path}`).catch(() => undefined);
  }
}

/**
 * Signs a Telegram Mini App initData string per the algorithm
 * apps/web/src/lib/telegramAuth.ts validates against, using the same
 * TELEGRAM_BOT_TOKEN the dev server is spawned with below ("TEST:TOKEN") —
 * lets a fetch-only test log in as an arbitrary telegram_id without a
 * browser, independently of the shared OWNER_TELEGRAM_ID user other tests
 * mutate (including one that deletes it outright).
 */
function buildTelegramInitData(telegramId: string, firstName: string): string {
  const authDate = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("user", JSON.stringify({ id: Number(telegramId), first_name: firstName }));
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update("TEST:TOKEN").digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

before(async () => {
  // --- database: fresh throwaway DB, migrated, seeded with realistic data ---
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
  const db = await import("@nevidimka/db");

  const user = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID, firstName: "Никита" });
  const mission = await db.createMission({
    userId: user.id,
    title: "Собрать личную операционную систему",
    description: "180 дней на дисциплину, продукт и форму.",
    directions: ["Создание", "Тело", "Смелость"],
    commitmentText: "Обещаю себе доводить начатое до конца, даже когда трудно и не хочется.",
  });
  await db.createMilestone({ userId: user.id, missionId: mission.id, title: "MVP готов", targetDay: 30 });

  const today = new Date().toISOString().slice(0, 10);
  const plan = await db.getOrCreateTodayPlan(user.id, today, 12);
  await db.saveCheckIn(user.id, plan.id, { sleepQuality: 4, energy: 3, mood: 4, stress: 2 });
  await db.setPlanAiSummary(user.id, plan.id, "Никита, день 12 из 180. Продолжаем начатое.");
  const mainTask = await db.createTask({
    userId: user.id, dailyPlanId: plan.id, missionId: mission.id,
    title: "Настроить CI и написать первый эндпоинт", isMainTask: true,
    estimateMinutes: 45, direction: "Создание",
  });
  await db.addEvidence({ userId: user.id, taskId: mainTask.id, kind: "text", rawText: "CI настроен, эндпоинт написан." });
  await db.addIdea(user.id, "Добавить тёмную тему в Mini App");
  await db.addMentorMessage({ userId: user.id, role: "user", content: "Как дела с прогрессом?" });
  await db.addMentorMessage({ userId: user.id, role: "assistant", content: "Темп стабильный, продолжай." });

  // A video asset in preview_ready state, with real (placeholder) files on
  // disk at the path the file-serving API route will actually read from —
  // exercising the video screens doesn't need a real playable video, just
  // a real file to exist so the route doesn't 404.
  const { mkdir, writeFile: writeFileFs } = await import("node:fs/promises");
  const videoStorageDir = join(import.meta.dirname, "..", ".e2e-video-storage");
  const videoAsset = await db.createVideoAsset({
    userId: user.id,
    originalStoragePath: join(videoStorageDir, "original.mp4"),
  });
  videoAssetId = videoAsset.id;
  const outputDir = join(videoStorageDir, videoAsset.id, "output");
  await mkdir(outputDir, { recursive: true });
  await writeFileFs(join(outputDir, "preview.mp4"), "placeholder");
  await writeFileFs(join(outputDir, "cover.jpg"), "placeholder");
  await db.createVideoRender({
    userId: user.id,
    videoAssetId: videoAsset.id,
    kind: "preview",
    storagePath: join(outputDir, "preview.mp4"),
    coverPath: join(outputDir, "cover.jpg"),
    width: 1080,
    height: 1920,
    durationSeconds: 7.2,
  });
  await db.updateVideoAssetStatus(user.id, videoAsset.id, "preview_ready");

  // A real published post, so the history screens have something to show
  // and edit/delete against.
  const draft = await db.createContentDraft({ userId: user.id, sourceText: "Тестовый пост для истории." });
  const version = await db.addContentVersion({
    userId: user.id,
    draftId: draft.id,
    step: "final",
    text: "Тестовый пост для истории.",
  });
  const publication = await db.createTextPublication({
    userId: user.id,
    draftId: draft.id,
    contentVersionId: version.id,
    channelId: "@test_channel",
    publishedHtml: "Тестовый пост для истории.",
  });
  await db.markPublicationSent(user.id, publication.id, 9001);
  publicationId = publication.id;

  await db.closePool();

  // --- mock Anthropic + mock Telegram, so AI-backed and publish/edit/delete screens work end to end ---
  mockAi = await startMockAnthropic();
  mockTg = await startMockTelegram();

  // --- real Next.js dev server, real child process ---
  // fileURLToPath (not .pathname) so this resolves to a real filesystem
  // path on Windows too (.pathname keeps a leading "/" before the drive
  // letter, which neither spawn() nor a bare exec name can use). On
  // Windows, npm-installed bins are .cmd shims that need shell:true to run.
  const nextBin = fileURLToPath(new URL("../../../node_modules/.bin/next", import.meta.url));
  devServer = spawn(nextBin, ["dev", "-p", String(WEB_PORT)], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DATABASE_URL: urlForDb(TEST_DB),
      JWT_SECRET: "test-secret-for-e2e",
      OWNER_TELEGRAM_ID,
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_API_BASE_URL: mockAi.url,
      TELEGRAM_BOT_TOKEN: "TEST:TOKEN",
      TELEGRAM_API_BASE_URL: mockTg.url,
      VIDEO_STORAGE_ROOT: join(import.meta.dirname, "..", ".e2e-video-storage"),
      NODE_ENV: "development",
    },
    stdio: "pipe",
  });
  devServer.stderr?.on("data", (d) => process.stderr.write(`[next:err] ${d}`));
  await waitForServer(BASE);
  await warmUpRoutes(BASE, ["/", "/today", "/path", "/journal", "/mentor", "/ideas", "/studio/video", "/studio/history", "/settings", "/manifest.json", "/sw.js"]);

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (err) => pageErrors.push(err.message));
});

after(async () => {
  await browser?.close();
  if (devServer && !devServer.killed) {
    const exited = new Promise<void>((resolve) => devServer.once("exit", () => resolve()));
    devServer.kill("SIGKILL");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  await mockAi?.close();
  await mockTg?.close();

  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await rm(join(import.meta.dirname, "..", ".e2e-video-storage"), { recursive: true, force: true }).catch(
    () => undefined
  );

  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  // Dev-server connection cleanup after SIGKILL isn't perfectly
  // synchronous with the OS reporting the process as exited — retry
  // rather than race it precisely.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await admin.query(`drop database if exists ${TEST_DB}`);
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await admin.end();
});

test("root redirects to /today with real data rendered (real browser, real JS execution)", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/today/, { timeout: 25000 });
  assert.ok(page.url().includes("/today"));
  assert.ok(await waitForText(page, "Настроить CI"), "main task from the seeded DB must render");
  assert.ok(await waitForText(page, "день 12 из 180"), "AI plan summary must render");
});

test("bottom nav: /path lists active goals; tapping a card opens mission, milestone, and commitment text", async () => {
  await page.click("text=Путь");
  await page.waitForURL(/\/path$/, { timeout: 5000 });
  assert.ok(
    await waitForText(page, "Собрать личную операционную систему"),
    "goal list must show the seeded mission's title as a card"
  );

  await page.click("text=Собрать личную операционную систему");
  await page.waitForURL(/\/path\/.+/, { timeout: 5000 });
  assert.ok(await waitForText(page, "Собрать личную операционную систему"));
  assert.ok(await waitForText(page, "MVP готов"));
  assert.ok(await waitForText(page, "доводить начатое"));
});

test("bottom nav: /journal shows evidence from DB", async () => {
  await page.click("text=Дневник");
  await page.waitForURL(/\/journal/, { timeout: 5000 });
  assert.ok(await waitForText(page, "CI настроен"));
});

test("/mentor: chat history loads, and sending a message round-trips through the (mocked) AI", async () => {
  await page.click("text=Наставник");
  await page.waitForURL(/\/mentor/, { timeout: 5000 });
  assert.ok(await waitForText(page, "Как дела с прогрессом"));

  await page.fill('input[placeholder="Сообщение…"]', "Что делать дальше?");
  await page.click('button:has-text("→")');
  assert.ok(await waitForText(page, "Что делать дальше?"), "sent message must appear in the thread");
  assert.ok(await waitForText(page, "темп стабильный"), "AI reply must arrive and render");
});

test("/ideas: submitting the form actually writes to the DB and updates the list", async () => {
  await page.goto(`${BASE}/ideas`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "тёмную тему"));

  await page.fill('textarea[placeholder*="переключаясь"]', "Written by the committed e2e test");
  await page.click('button:has-text("Сохранить")');
  assert.ok(await waitForText(page, "Written by the committed e2e test"));
});

test("/studio/video: list shows the seeded video's status", async () => {
  await page.goto(`${BASE}/studio/video`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "превью готово"), "seeded video's status label must render");
});

test("/studio/video/[id]: preview player and confirm button; clicking confirm updates status", async () => {
  await page.goto(`${BASE}/studio/video/${videoAssetId}`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Подтвердить и опубликовать"), "confirm button must render for a preview_ready asset");

  await page.click('button:has-text("Подтвердить и опубликовать")');
  assert.ok(
    await waitForText(page, "Рендерю"),
    "after confirming, the screen must reflect the confirmed/rendering state"
  );

  const db = await import("@nevidimka/db");
  const owner = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID });
  const asset = await db.getVideoAsset(owner.id, videoAssetId);
  assert.equal(asset?.status, "confirmed", "clicking confirm must actually persist the status change to the DB");
  await db.closePool();
});

test("/api/video/[id]/file: real HTTP Range support (206 Partial Content, correct byte slice)", async () => {
  // The seeded preview.mp4 placeholder file's content is literally the
  // string "placeholder" (11 bytes) — request the first 4 bytes and check
  // both the status/headers and the actual returned bytes match exactly.
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const rangeRes = await fetch(`${BASE}/api/video/${videoAssetId}/file?variant=preview`, {
    headers: { Cookie: cookieHeader, Range: "bytes=0-3" },
  });
  assert.equal(rangeRes.status, 206, "a Range request must get 206 Partial Content, not 200");
  assert.equal(rangeRes.headers.get("content-range"), "bytes 0-3/11");
  assert.equal(rangeRes.headers.get("content-length"), "4");
  assert.equal(rangeRes.headers.get("accept-ranges"), "bytes");
  const body = await rangeRes.text();
  assert.equal(body, "plac", "the returned bytes must be exactly the requested slice, not the whole file");

  const fullRes = await fetch(`${BASE}/api/video/${videoAssetId}/file?variant=preview`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(fullRes.status, 200, "no Range header must still serve the full file normally");
  assert.equal(fullRes.headers.get("accept-ranges"), "bytes", "must advertise range support even on a full response");
  assert.equal(await fullRes.text(), "placeholder");
});

test("/api/today: checkin with 2 active missions plans and creates one main task per mission", async () => {
  // A fresh telegram_id (not OWNER_TELEGRAM_ID), signed in via real initData
  // rather than reusing the shared owner's browser cookies — the owner
  // already has a today-plan seeded in before() (and a later test deletes
  // the owner outright), so a separate user keeps this assertion ("exactly
  // 2 tasks, one per mission") independent of both.
  const telegramId = "700111333";
  const initData = buildTelegramInitData(telegramId, "Тест Мультицель");
  // middleware.ts CSRF-gates every non-GET /api/* route on Sec-Fetch-Site
  // (see lib/csrf.ts) — real browsers set this automatically, but Node's
  // fetch() does not, so it has to be supplied explicitly here (unlike a
  // browser's fetch, Node's does not forbid setting Sec-Fetch-* headers).
  const sameOriginHeaders = { "Sec-Fetch-Site": "same-origin" };
  const authRes = await fetch(`${BASE}/api/auth/miniapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sameOriginHeaders },
    body: JSON.stringify({ initData }),
  });
  assert.equal(authRes.status, 200, "initData signed with the test bot token must authenticate");
  const { userId } = (await authRes.json()) as { userId: string };
  const setCookie = authRes.headers.get("set-cookie") ?? "";
  const cookieHeader = setCookie.split(";")[0];
  assert.ok(cookieHeader.startsWith("nevidimka_session="), "must receive a session cookie");

  const db = await import("@nevidimka/db");
  const mission1 = await db.createMission({
    userId,
    title: "Первая цель",
    directions: ["Тело"],
    commitmentText: "Обещаю себе.",
  });
  const mission2 = await db.createMission({
    userId,
    title: "Вторая цель",
    directions: ["Смелость"],
    commitmentText: "Обещаю себе.",
  });
  await db.closePool();

  const checkinRes = await fetch(`${BASE}/api/today`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader, ...sameOriginHeaders },
    body: JSON.stringify({ action: "checkin", sleepQuality: 4, energy: 4, mood: 3, stress: 2 }),
  });
  assert.equal(checkinRes.status, 200, "checkin with 2 active missions must succeed, not error");
  const checkinBody = await checkinRes.json();
  assert.equal(checkinBody.ok, true);

  const todayRes = await fetch(`${BASE}/api/today`, { headers: { Cookie: cookieHeader } });
  assert.equal(todayRes.status, 200);
  const today = (await todayRes.json()) as {
    state: string;
    missions: { id: string; title: string }[];
    tasks: { missionId?: string; isMainTask: boolean }[];
  };
  assert.equal(today.state, "ready", "a main task exists for every active mission, so the day must read as planned");
  assert.equal(today.missions.length, 2, "response must list both active missions");

  const mainTasks = today.tasks.filter((t) => t.isMainTask);
  assert.equal(mainTasks.length, 2, "must create exactly one main task per active mission");
  const taskMissionIds = mainTasks.map((t) => t.missionId).sort();
  assert.deepEqual(
    taskMissionIds,
    [mission1.id, mission2.id].sort(),
    "each main task's missionId must match one of the 2 active missions"
  );
});

test("/api/mentor: 2 active missions, no missionId, falls back to multi-goal summary and still succeeds", async () => {
  // Fresh telegram_id, same reasoning as the /api/today multi-mission test
  // above: keeps this independent of the shared owner's seeded single
  // mission and mentor history.
  const telegramId = "700111444";
  const initData = buildTelegramInitData(telegramId, "Тест Мультицель Наставник");
  const sameOriginHeaders = { "Sec-Fetch-Site": "same-origin" };
  const authRes = await fetch(`${BASE}/api/auth/miniapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sameOriginHeaders },
    body: JSON.stringify({ initData }),
  });
  assert.equal(authRes.status, 200, "initData signed with the test bot token must authenticate");
  const { userId } = (await authRes.json()) as { userId: string };
  const setCookie = authRes.headers.get("set-cookie") ?? "";
  const cookieHeader = setCookie.split(";")[0];
  assert.ok(cookieHeader.startsWith("nevidimka_session="), "must receive a session cookie");

  const db = await import("@nevidimka/db");
  await db.createMission({
    userId,
    title: "Первая цель наставника",
    directions: ["Тело"],
    commitmentText: "Обещаю себе.",
  });
  await db.createMission({
    userId,
    title: "Вторая цель наставника",
    directions: ["Смелость"],
    commitmentText: "Обещаю себе.",
  });
  await db.closePool();

  // No missionId in the body — with 2 active missions this must take the
  // multi-goal summary branch (MentorChatMultiMissionContext) rather than
  // erroring or guessing which mission the message is about.
  const mentorRes = await fetch(`${BASE}/api/mentor`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader, ...sameOriginHeaders },
    body: JSON.stringify({ message: "Как мне лучше распределить силы между целями?" }),
  });
  assert.equal(mentorRes.status, 200, "summary-mode mentor chat (2 active missions, no missionId) must not error");
  const mentorBody = (await mentorRes.json()) as { ok: boolean; reply?: { content?: string } };
  assert.equal(mentorBody.ok, true);
  assert.ok(mentorBody.reply?.content, "a reply must come back even without a resolved single mission");
});

test("/api/path: 2 active missions, no missionId, returns list mode with both goals; missionId returns that goal's detail", async () => {
  // Fresh telegram_id, same reasoning as the other multi-mission tests above:
  // keeps this independent of the shared owner's single seeded mission.
  const telegramId = "700111555";
  const initData = buildTelegramInitData(telegramId, "Тест Мультицель Путь");
  const sameOriginHeaders = { "Sec-Fetch-Site": "same-origin" };
  const authRes = await fetch(`${BASE}/api/auth/miniapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sameOriginHeaders },
    body: JSON.stringify({ initData }),
  });
  assert.equal(authRes.status, 200, "initData signed with the test bot token must authenticate");
  const { userId } = (await authRes.json()) as { userId: string };
  const setCookie = authRes.headers.get("set-cookie") ?? "";
  const cookieHeader = setCookie.split(";")[0];
  assert.ok(cookieHeader.startsWith("nevidimka_session="), "must receive a session cookie");

  const db = await import("@nevidimka/db");
  const mission1 = await db.createMission({
    userId,
    title: "Путь: первая цель",
    directions: ["Тело"],
    commitmentText: "Обещаю себе.",
  });
  const mission2 = await db.createMission({
    userId,
    title: "Путь: вторая цель",
    directions: ["Смелость"],
    commitmentText: "Обещаю себе.",
  });
  await db.closePool();

  const listRes = await fetch(`${BASE}/api/path`, { headers: { Cookie: cookieHeader } });
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { state: string; missions: { id: string; title: string }[] };
  assert.equal(list.state, "list", "no missionId with 2+ active missions must return list mode, not a single mission");
  assert.equal(list.missions.length, 2, "list mode must return both active missions");
  assert.deepEqual(
    list.missions.map((m) => m.id).sort(),
    [mission1.id, mission2.id].sort(),
    "list mode must include exactly the 2 active missions, keyed by id"
  );

  const detailRes = await fetch(`${BASE}/api/path?missionId=${mission2.id}`, { headers: { Cookie: cookieHeader } });
  assert.equal(detailRes.status, 200);
  const detail = (await detailRes.json()) as { state: string; mission: { id: string; title: string } };
  assert.equal(detail.state, "ready");
  assert.equal(detail.mission.title, "Путь: вторая цель", "detail mode must be keyed off the requested missionId, not just 'the' active mission");
});

test("/api/content/[id]: publish with 2 active missions and no missionId is rejected with a 4xx listing the active missions", async () => {
  // Fresh telegram_id, same reasoning as the other multi-mission tests above:
  // keeps this independent of the shared owner's single seeded mission and
  // publications.
  const telegramId = "700111666";
  const initData = buildTelegramInitData(telegramId, "Тест Мультицель Публикация");
  const sameOriginHeaders = { "Sec-Fetch-Site": "same-origin" };
  const authRes = await fetch(`${BASE}/api/auth/miniapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sameOriginHeaders },
    body: JSON.stringify({ initData }),
  });
  assert.equal(authRes.status, 200, "initData signed with the test bot token must authenticate");
  const { userId } = (await authRes.json()) as { userId: string };
  const setCookie = authRes.headers.get("set-cookie") ?? "";
  const cookieHeader = setCookie.split(";")[0];
  assert.ok(cookieHeader.startsWith("nevidimka_session="), "must receive a session cookie");

  const db = await import("@nevidimka/db");
  const mission1 = await db.createMission({
    userId,
    title: "Публикация: первая цель",
    directions: ["Тело"],
    commitmentText: "Обещаю себе.",
  });
  const mission2 = await db.createMission({
    userId,
    title: "Публикация: вторая цель",
    directions: ["Смелость"],
    commitmentText: "Обещаю себе.",
  });
  const draft = await db.createContentDraft({ userId, sourceText: "Текст для публикации." });
  const version = await db.addContentVersion({
    userId,
    draftId: draft.id,
    step: "final",
    text: "Текст для публикации.",
  });
  await db.setChosenVersion(userId, draft.id, version.id);
  await db.closePool();

  // No missionId in the body — with 2 active missions this is genuinely
  // ambiguous (ContentDraft carries no missionId of its own, see the comment
  // in the "publish" case of apps/web/src/app/api/content/[id]/route.ts), so
  // the route must reject with a clear 4xx rather than guessing which
  // mission's day-N/program length to attribute the post to.
  const publishRes = await fetch(`${BASE}/api/content/${draft.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader, ...sameOriginHeaders },
    body: JSON.stringify({ action: "publish" }),
  });
  assert.equal(
    publishRes.status,
    400,
    "publish with 2 active missions and no missionId must be rejected with a 4xx, not guess or crash"
  );
  const publishBody = (await publishRes.json()) as {
    code: string;
    missions: { id: string; title: string }[];
  };
  assert.equal(publishBody.code, "MISSION_ID_REQUIRED");
  assert.deepEqual(
    publishBody.missions.map((m) => m.id).sort(),
    [mission1.id, mission2.id].sort(),
    "error body must list the active missions so a future picker UI can be built against it"
  );
});

test("/analytics: 'что ты заметил' button triggers the behavior-analyst AI and renders a real observation", async () => {
  await page.goto(`${BASE}/analytics`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Что ты заметил?"));

  await page.click('button:has-text("Что ты заметил?")');
  assert.ok(
    await waitForText(page, "Темп выполнения стабильный"),
    "AI observation (from the mocked behavior_analyst role) must render"
  );
});

test("/skills: guidance button triggers the skills-mentor AI and renders real guidance", async () => {
  await page.goto(`${BASE}/skills`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Как баланс между направлениями?"));

  await page.click('button:has-text("Как баланс между направлениями?")');
  assert.ok(
    await waitForText(page, "Хороший темп"),
    "AI guidance (from the mocked skills_mentor role) must render"
  );
});

test("/studio/history: lists the seeded published post", async () => {
  await page.goto(`${BASE}/studio/history`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Тестовый пост для истории"));
  assert.ok(await waitForText(page, "опубликовано"));
});

test("/studio/history/[id]: editing calls the real Telegram API and updates status + text", async () => {
  await page.goto(`${BASE}/studio/history/${publicationId}`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Тестовый пост для истории"));

  await page.click('button:has-text("Редактировать")');
  const textarea = page.locator("textarea");
  await textarea.fill("Отредактированный текст поста.");
  await page.click('button:has-text("Сохранить в канале")');

  assert.ok(await waitForText(page, "Отредактированный текст поста"), "edited text must render as the current text");
  assert.ok(await waitForText(page, "отредактировано"), "status must switch to edited");
  assert.ok(await waitForText(page, "Тестовый пост для истории"), "original text must still be shown separately");

  const editCall = mockTg.calls.find((c) => c.method === "editMessageText");
  assert.ok(editCall, "editChannelMessage must have actually called the Telegram API");
  assert.equal(editCall!.payload.text, "Отредактированный текст поста.");

  const db = await import("@nevidimka/db");
  const owner = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID });
  const pub = await db.getPublication(owner.id, publicationId);
  assert.equal(pub?.status, "edited");
  assert.equal(pub?.publishedHtml, "Тестовый пост для истории.", "original snapshot must stay untouched");
  await db.closePool();
});

test("/studio/history/[id]: deleting calls the real Telegram API and updates status", async () => {
  await page.click('button:has-text("Удалить из канала")');
  assert.ok(await waitForText(page, "Удалено из канала"));

  const deleteCall = mockTg.calls.find((c) => c.method === "deleteMessage");
  assert.ok(deleteCall, "deleteChannelMessage must have actually called the Telegram API");

  const db = await import("@nevidimka/db");
  const owner = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID });
  const pub = await db.getPublication(owner.id, publicationId);
  assert.equal(pub?.status, "deleted");
  await db.closePool();
});

test("/settings: connecting a channel verifies bot rights via Telegram API and persists channel_id", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Канал"));

  await page.fill('input[placeholder="@my_channel"]', "@my_test_channel");
  await page.click('button:has-text("Проверить и подключить")');
  assert.ok(await waitForText(page, "подключён"), "success message must render after connecting");

  const getMeCall = mockTg.calls.find((c) => c.method === "getMe");
  const memberCall = mockTg.calls.find((c) => c.method === "getChatMember");
  const testMsgCall = mockTg.calls.find(
    (c) => c.method === "sendMessage" && c.payload.chat_id === "@my_test_channel"
  );
  assert.ok(getMeCall, "must call getMe to resolve the bot's own id");
  assert.ok(memberCall, "must call getChatMember to verify admin rights before saving");
  assert.ok(testMsgCall, "must send a real test message to confirm the connection end to end");

  const db = await import("@nevidimka/db");
  const owner = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID });
  const updated = await db.getUserById(owner.id);
  assert.equal(updated?.channelId, "@my_test_channel", "channel_id must actually be persisted");
  await db.closePool();
});

test("/settings: timezone and reminder hours actually persist to the DB", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Часовой пояс"));

  const tzInput = page.locator("input").first();
  await tzInput.fill("Europe/Moscow");
  await page.click('button:has-text("Сохранить часовой пояс")');
  assert.ok(await waitForText(page, "сохранён"), "success message must appear after saving timezone");

  const morningCheckbox = page.locator('label:has-text("Утренний план") input[type="checkbox"]');
  await morningCheckbox.check();
  await page.selectOption('select >> nth=0', "7");
  await page.click('button:has-text("Сохранить напоминания")');
  assert.ok(await waitForText(page, "сохранены"), "success message must appear after saving reminders");

  const db = await import("@nevidimka/db");
  const owner = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID });
  const updated = await db.getUserById(owner.id);
  assert.equal(updated?.timezone, "Europe/Moscow", "timezone change must be persisted");
  assert.equal(updated?.reminderHourMorning, 7, "reminder hour change must be persisted");
  await db.closePool();
});

test("/settings: data export downloads real JSON containing this user's data", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click('a:has-text("Скачать все мои данные")'),
  ]);
  const exportPath = await download.path();
  assert.ok(exportPath, "export must actually produce a downloadable file");
  const { readFile } = await import("node:fs/promises");
  const content = JSON.parse(await readFile(exportPath!, "utf8"));
  assert.ok(Array.isArray(content.users) && content.users.length === 1, "export must contain this user's own row");
  assert.ok(Array.isArray(content.missions) && content.missions.length === 1, "export must contain the seeded mission");
  assert.ok(Array.isArray(content.ideas) && content.ideas.length >= 1, "export must contain seeded ideas");
});

test("/settings: account deletion cascades for real, confirmed by direct DB check", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.click('button:has-text("Удалить аккаунт")');
  assert.ok(await waitForText(page, "Напиши DELETE"));

  await page.fill('input[placeholder="DELETE"]', "wrong text");
  const deleteBtn = page.locator('button:has-text("Удалить безвозвратно")');
  assert.ok(await deleteBtn.isDisabled(), "delete button must stay disabled until the exact confirmation text is typed");

  await page.fill('input[placeholder="DELETE"]', "DELETE");
  await deleteBtn.click();
  await page.waitForURL(/\/today/, { timeout: 10000 });

  const db = await import("@nevidimka/db");
  const check = new (await import("pg")).default.Client({ connectionString: urlForDb(TEST_DB) });
  await check.connect();
  const r = await check.query("select count(*)::int as n from users where telegram_id = $1", [OWNER_TELEGRAM_ID]);
  await check.end();
  assert.equal(r.rows[0].n, 0, "user row must actually be gone from the database, not just logged out client-side");
  await db.closePool();
});

test("PWA assets are served correctly", async () => {
  const manifestRes = await fetch(`${BASE}/manifest.json`);
  assert.equal(manifestRes.status, 200);
  const manifestJson = await manifestRes.json();
  assert.equal(manifestJson.name, "Невидимка");
  assert.ok(Array.isArray(manifestJson.icons) && manifestJson.icons.length > 0);

  const swRes = await fetch(`${BASE}/sw.js`);
  assert.equal(swRes.status, 200);
});

test("no unhandled client-side JS exceptions occurred during the whole run", () => {
  assert.deepEqual(pageErrors, []);
});
