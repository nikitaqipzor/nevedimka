// End-to-end test for the Mini App, in a real browser. Run:
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test test/e2e.test.ts
// (DATABASE_URL must be a superuser connection — the test creates and
// drops its own throwaway database.) Requires Chromium; if not already
// present, `npx playwright install --with-deps chromium` first.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import pg from "pg";
import { startMockAnthropic } from "./mock-anthropic.js";
import { startMockTelegram } from "./mock-telegram.js";
import { stopServerTree } from "./process-tree.js";
import { todayInTimezone } from "../src/lib/dates.js";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "nevidimka_web_e2e_test";
const WEB_PORT = 3947;
const BASE = `http://localhost:${WEB_PORT}`;
const OWNER_TELEGRAM_ID = "700111222";

function signedInitData(id: number): string {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "Test" }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update("TEST:TOKEN").digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
}

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
  let lastText = "";
  while (Date.now() - start < timeoutMs) {
    const text = await p.textContent("body").catch(() => "");
    lastText = text ?? "";
    if (text?.includes(substring)) return true;
    await p.waitForTimeout(150);
  }
  // On timeout, say what WAS on screen. Without this a failure reports only
  // "expected true, got false", which says nothing about why — and chasing it
  // means re-running the whole suite blind.
  console.error(
    `[waitForText] timed out waiting for ${JSON.stringify(substring)} at ${p.url()}
` +
      `  body was: ${lastText.replace(/\s+/g, " ").slice(0, 400)}`
  );
  return false;
}

/**
 * Waits for text that lives in a form field's VALUE rather than in the
 * document's text.
 *
 * waitForText reads textContent, which never includes the value of an
 * <input> or <textarea> — the value is a property, not a child node. The
 * onboarding review step and the Path editors put the mission title,
 * milestone names and days into inputs precisely so they can be edited
 * before saving, so asserting on them needs this instead. Using waitForText
 * there produces a 15-second timeout and a failure that looks like the app
 * never rendered, when in fact it rendered correctly.
 */
async function waitForFieldValue(p: Page, substring: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  let last: string[] = [];
  while (Date.now() - start < timeoutMs) {
    last = await p
      .locator("input, textarea")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
      .catch(() => [] as string[]);
    if (last.some((v) => v.includes(substring))) return true;
    await p.waitForTimeout(150);
  }
  console.error(
    `[waitForFieldValue] timed out waiting for ${JSON.stringify(substring)} at ${p.url()}
` +
      `  field values were: ${JSON.stringify(last).slice(0, 400)}`
  );
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

  const today = todayInTimezone(user.timezone);
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
  // Resolved via import.meta.dirname, not `new URL(...).pathname`: on Windows
  // the latter yields "/G:/path/..." — a leading slash that makes spawn fail
  // with ENOENT. The .cmd suffix is also required there, since npm creates a
  // shell wrapper rather than an executable bin, and spawning a .cmd needs a
  // shell. On POSIX the bare name is correct and no shell is needed.
  const isWindows = process.platform === "win32";
  const nextBin = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "node_modules",
    ".bin",
    isWindows ? "next.cmd" : "next"
  );
  devServer = spawn(nextBin, ["dev", "-p", String(WEB_PORT)], {
    cwd: join(import.meta.dirname, ".."),
    shell: isWindows,
    detached: !isWindows,
    env: {
      ...process.env,
      DATABASE_URL: urlForDb(TEST_DB),
      JWT_SECRET: "test-secret-for-e2e",
      OWNER_TELEGRAM_ID,
      // Signed Telegram browser fixture exercises auth without a dev bypass.
      ALLOW_DEV_AUTH: "false",
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
  devServer.stdout?.on("data", () => undefined);
  await waitForServer(BASE);
  await warmUpRoutes(BASE, ["/", "/today", "/path", "/journal", "/mentor", "/ideas", "/studio/video", "/studio/history", "/settings", "/manifest.json", "/sw.js"]);

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Provider APIs already use fixtures. Do not let Telegram CDN availability
  // block beforeInteractive hydration; authenticate with a real signed payload.
  await page.route("https://telegram.org/js/telegram-web-app.js", route => route.fulfill({
    contentType: "application/javascript",
    body: `window.Telegram={WebApp:{initData:${JSON.stringify(signedInitData(Number(OWNER_TELEGRAM_ID)))},ready(){},expand(){}}};`,
  }));
  page.on("pageerror", (err) => pageErrors.push(err.message));
});

after(async () => {
  // Attempt every cleanup even when an earlier resource fails to close.
  const errors: unknown[] = [];
  for (const cleanup of [
    () => browser?.close(),
    () => stopServerTree(devServer),
    () => mockAi?.close(),
    () => mockTg?.close(),
    async () => (await import("@nevidimka/db")).closePool(),
  ]) {
    try { await cleanup(); } catch (err) { errors.push(err); }
  }

  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await rm(join(import.meta.dirname, "..", ".e2e-video-storage"), { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
    await admin.query("set statement_timeout = '10s'");
    await admin.query(`drop database if exists ${TEST_DB}`);
  } catch (err) {
    errors.push(err);
  } finally {
    await admin.end();
  }
  if (errors.length) throw new AggregateError(errors, "E2E cleanup failed");
}, { timeout: 30000 });

test("signed initData from a non-owner cannot register through Mini App", async () => {
  const response = await fetch(`${BASE}/api/auth/miniapp`, { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ initData: signedInitData(700111223) }) });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "OWNER_ONLY");
  const client = new pg.Client({ connectionString: urlForDb(TEST_DB) });
  try { await client.connect(); const rows = await client.query("select 1 from users where telegram_id = '700111223'"); assert.equal(rows.rowCount, 0); }
  finally { await client.end(); }
});

test("root redirects to /today with real data rendered (real browser, real JS execution)", async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/today/, { timeout: 25000 });
  assert.ok(page.url().includes("/today"));
  assert.equal(await page.locator("main").evaluate(el => getComputedStyle(el).maxWidth), "448px", "Tailwind layout utilities must be present");
  assert.ok(await waitForText(page, "Настроить CI"), "main task from the seeded DB must render");
  assert.ok(await waitForText(page, "день 12 из 180"), "AI plan summary must render");
});

test("bottom nav: /path shows mission, milestone, and commitment text", async () => {
  await page.click("text=Путь");
  await page.waitForURL(/\/path/, { timeout: 5000 });
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
  // Includes a "<" on purpose: editMessageText is sent with
  // parse_mode: "HTML", so an unescaped angle bracket makes Telegram reject
  // the whole edit ("can't parse entities"). The route must escape what it
  // sends while storing the text the UI actually displays.
  await textarea.fill("Отредактированный текст поста <3.");
  await page.click('button:has-text("Сохранить в канале")');

  assert.ok(await waitForText(page, "Отредактированный текст поста"), "edited text must render as the current text");
  assert.ok(await waitForText(page, "отредактировано"), "status must switch to edited");
  assert.ok(await waitForText(page, "Тестовый пост для истории"), "original text must still be shown separately");

  const editCall = mockTg.calls.find((c) => c.method === "editMessageText");
  assert.ok(editCall, "editChannelMessage must have actually called the Telegram API");
  assert.equal(
    editCall!.payload.text,
    "Отредактированный текст поста &lt;3.",
    "text sent to Telegram must be HTML-escaped for parse_mode: HTML"
  );

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

/**
 * Runs AFTER the account-deletion test on purpose: that leaves the browser on
 * /today with no user and no mission, which is exactly the state a first-time
 * visitor is in. A fresh session is created by AuthProvider on load (dev auth
 * re-creates the owner row), so this exercises the real cold-start path.
 *
 * Covers PROJECT_SPEC.md section 20's Release 2 criterion: starting a path
 * had been possible only through the bot's /start conversation, so the web
 * screens dead-ended at "Заверши онбординг в боте".
 */
test("/onboarding: a path can be started entirely from the web, no bot involved", async () => {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  assert.ok(
    await waitForText(page, "Начать путь"),
    "an empty Today must offer to start the path, not just point at the bot"
  );

  await page.click('button:has-text("Начать путь")');
  assert.ok(await waitForText(page, "День 0"), "step 1: Day 0");
  await page.click('button:has-text("Дальше")');

  assert.ok(await waitForText(page, "Договор с собой"), "step 2: commitment");
  await page.fill("textarea", "Обещаю доводить начатое до конца.");
  await page.click('button:has-text("Дальше")');

  assert.ok(await waitForText(page, "Одна главная цель"), "step 3: goal");
  await page.fill("textarea", "Запустить продукт и довести до первого дохода");
  await page.click('button:has-text("Дальше")');

  assert.ok(await waitForText(page, "Срок"), "step 4: program length");
  await page.click('button:has-text("180 дней")');
  await page.click('button:has-text("Дальше")');

  assert.ok(await waitForText(page, "Направления развития"), "step 5: directions");
  await page.click('button:has-text("Создание")');
  await page.fill('input[placeholder="Своё направление"]', "Публичность");
  await page.click('button:has-text("Добавить")');

  // Strategist call goes through the mock Anthropic server.
  await page.click('button:has-text("Сформулировать миссию")');
  assert.ok(
    await waitForText(page, "предложение AI-стратега"),
    "step 6: the draft must come back and be presented as unsaved"
  );
  assert.ok(
    await waitForFieldValue(page, "Запустить продукт и довести до дохода"),
    "the strategist's proposed title must render (in an editable field)"
  );

  await page.click('button:has-text("Принять и запустить")');
  await page.waitForURL(/\/today/, { timeout: 15000 });

  // The mission is real: Path renders it, and the DB has it with its
  // milestones and the custom direction.
  await page.goto(`${BASE}/path`, { waitUntil: "domcontentloaded" });
  assert.ok(
    await waitForText(page, "Запустить продукт и довести до дохода"),
    "the new mission must appear on the Path screen"
  );
  assert.ok(await waitForText(page, "Публичность"), "the custom direction must persist");

  const db = await import("@nevidimka/db");
  const owner = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID });
  const mission = await db.getActiveMission(owner.id);
  assert.ok(mission, "an active mission must exist in the database");
  assert.equal(mission!.commitmentText, "Обещаю доводить начатое до конца.");
  const milestones = await db.listMilestones(owner.id, mission!.id);
  assert.equal(milestones.length, 2, "the strategist's milestones must be persisted");
  await db.closePool();
});

test("/path: mission, commitment and milestones are all editable in place", async () => {
  await page.goto(`${BASE}/path`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Запустить продукт"));

  // Three independent editors — mission, commitment, milestones.
  assert.equal(
    await page.locator('button:has-text("Изменить")').count(),
    3,
    "each editable section needs its own control"
  );

  // --- mission ---
  await page.locator('button:has-text("Изменить")').first().click();
  // The mission editor is identified by its direction input. Waiting on the
  // element, not on text: "Добавить направление" is a placeholder attribute,
  // which textContent never contains.
  await page
    .locator('input[placeholder="Добавить направление"]')
    .waitFor({ state: "visible", timeout: 15000 });
  // The title is the only text input that is not the direction field, and
  // not a number/date input. Selecting by position alone would silently
  // target the wrong box if the editor's layout ever changes.
  await page
    .locator('input:not([placeholder="Добавить направление"]):not([type="number"]):not([type="date"])')
    .first()
    .fill("Миссия, переписанная из веба");
  await page.click('button:has-text("Сохранить")');
  assert.ok(
    await waitForText(page, "Миссия, переписанная из веба"),
    "the edited title must render after saving"
  );

  // --- commitment ---
  await page.locator('button:has-text("Изменить")').nth(1).click();
  await page.locator("textarea").fill("Договор, переписанный из веба.");
  await page.click('button:has-text("Сохранить")');
  assert.ok(await waitForText(page, "Договор, переписанный из веба."));

  // --- milestones: add one, and check it sorts by day ---
  await page.locator('button:has-text("Изменить")').nth(2).click();
  assert.ok(await waitForText(page, "Добавить этап"));
  await page.click('button:has-text("Добавить этап")');
  await page.locator('input[type="number"]').last().fill("45");
  await page
    .locator('input:not([type="number"]):not([type="date"])')
    .last()
    .fill("Этап, добавленный из веба");
  await page.click('button:has-text("Сохранить")');
  assert.ok(await waitForText(page, "Этап, добавленный из веба"));
  assert.ok(await waitForText(page, "день 45"));

  // Persisted, not just rendered.
  const db = await import("@nevidimka/db");
  const owner = await db.getOrCreateUser({ telegramId: OWNER_TELEGRAM_ID });
  const mission = await db.getActiveMission(owner.id);
  assert.equal(mission!.title, "Миссия, переписанная из веба");
  assert.equal(mission!.commitmentText, "Договор, переписанный из веба.");
  await db.closePool();
});

test("/path: cancelling an edit discards it, and invalid input is refused with a message", async () => {
  await page.goto(`${BASE}/path`, { waitUntil: "domcontentloaded" });
  assert.ok(await waitForText(page, "Договор, переписанный из веба."));

  // Cancel must not write.
  await page.locator('button:has-text("Изменить")').nth(1).click();
  await page.locator("textarea").fill("ЭТОГО НЕ ДОЛЖНО БЫТЬ В БАЗЕ");
  await page.click('button:has-text("Отмена")');
  await page.waitForTimeout(400);
  const body = (await page.textContent("body")) ?? "";
  assert.ok(
    !body.includes("ЭТОГО НЕ ДОЛЖНО БЫТЬ В БАЗЕ"),
    "a cancelled edit must not appear on screen"
  );
  assert.ok(body.includes("Договор, переписанный из веба."), "the saved value must remain");

  // Server-side validation must surface to the user, not fail silently.
  await page.locator('button:has-text("Изменить")').nth(2).click();
  assert.ok(await waitForText(page, "Добавить этап"));
  await page.locator('input[type="number"]').first().fill("9999");
  await page.click('button:has-text("Сохранить")');
  assert.ok(
    await waitForText(page, "День этапа должен быть"),
    "an out-of-range day must produce a visible error"
  );
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
