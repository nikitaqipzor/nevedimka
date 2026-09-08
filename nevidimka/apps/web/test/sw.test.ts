// Tests for the PWA service worker's caching policy. No database and no
// browser needed: sw.js is plain logic over a handful of globals, so it runs
// here against minimal stubs for `self`, `caches`, and `fetch`.
//
// Regression context — the policy this locks down was a real privacy leak.
// The worker used to cache EVERY successful GET, which quietly wrote
// /api/journal (the whole diary), /api/settings/export (a full data export),
// /api/mentor (chat history) and /api/video/[id]/file (entire video files)
// into the browser's Cache Storage. That store is origin-scoped,
// unencrypted, and survives logout, so on a shared or lost device the diary
// stayed readable with no session — directly against PROJECT_SPEC.md
// section 15 ("приватное хранение дневников и видео"). The fix is an
// allow-list; these tests exist so a future edit can't quietly widen it back
// into a deny-list.
//
// Run: npx tsx --test test/sw.test.ts

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SW_SOURCE = readFileSync(join(import.meta.dirname, "..", "public", "sw.js"), "utf8");
const ORIGIN = "https://app.example.test";

interface FetchEventLike {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

/** A single in-memory Cache Storage, recording exactly what gets stored. */
function makeCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();

  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };

  const api = {
    async open(name: string) {
      const store = cacheFor(name);
      return {
        async addAll(_urls: string[]) {
          /* install-time shell precache — not under test here */
        },
        async put(request: Request, response: Response) {
          store.set(new URL(request.url).pathname + new URL(request.url).search, response);
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async match(request: Request | string) {
      const key =
        typeof request === "string"
          ? request
          : new URL(request.url).pathname + new URL(request.url).search;
      for (const store of stores.values()) {
        const hit = store.get(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  return { api, stores };
}

/**
 * Loads sw.js with stubbed globals and returns a harness that can drive a
 * single fetch event through it.
 */
function loadServiceWorker(options: {
  /** What the network does for this request. */
  network: (request: Request) => Promise<Response>;
}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const { api: caches, stores } = makeCacheStorage();

  const self = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler);
    },
    skipWaiting() {},
    clients: { claim() {} },
    location: { origin: ORIGIN },
    registration: {},
  };

  const fn = new Function(
    "self",
    "caches",
    "fetch",
    "Response",
    "URL",
    `"use strict";${SW_SOURCE}`
  );
  fn(self, caches, options.network, Response, URL);

  return {
    stores,
    /**
     * Dispatches a fetch event. Returns the response the worker produced, or
     * null when the worker declined to handle it (never called respondWith) —
     * which for this worker means "pass through to the network, don't cache".
     */
    async dispatchFetch(request: Request): Promise<{ handled: boolean; response: Response | null }> {
      const handler = listeners.get("fetch");
      assert.ok(handler, "sw.js must register a fetch listener");

      let responded: Response | Promise<Response> | null = null;
      const event: FetchEventLike = {
        request,
        respondWith(r) {
          responded = r;
        },
      };
      handler(event);

      if (responded === null) return { handled: false, response: null };
      return { handled: true, response: await responded };
    },
    /** Cache keys currently written, across all cache versions. */
    cachedPaths(): string[] {
      const out: string[] = [];
      for (const store of stores.values()) out.push(...store.keys());
      return out.sort();
    },
  };
}

function ok(body = "{}"): Response {
  // `type` is read-only on a real Response; the worker checks it, so define it.
  const res = new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  Object.defineProperty(res, "type", { value: "basic" });
  return res;
}

function req(path: string, init: RequestInit & { mode?: RequestMode } = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

let online: (request: Request) => Promise<Response>;
let offline: (request: Request) => Promise<Response>;

beforeEach(() => {
  online = async () => ok();
  offline = async () => {
    throw new TypeError("Failed to fetch");
  };
});

// --- the privacy-critical cases ------------------------------------------

const PRIVATE_ENDPOINTS = [
  "/api/journal",
  "/api/settings/export",
  "/api/mentor",
  "/api/analytics",
  "/api/publications",
  "/api/video/abc-123/file?variant=final",
  "/api/content/abc-123",
];

for (const path of PRIVATE_ENDPOINTS) {
  test(`never caches ${path}`, async () => {
    const sw = loadServiceWorker({ network: online });
    await sw.dispatchFetch(req(path));

    assert.deepEqual(
      sw.cachedPaths(),
      [],
      `${path} must not be written to Cache Storage — it carries private user data`
    );
  });
}

test("the diary is still served, just never stored", async () => {
  let networkCalls = 0;
  const sw = loadServiceWorker({
    network: async () => {
      networkCalls++;
      return ok('{"evidences":[]}');
    },
  });

  const { handled } = await sw.dispatchFetch(req("/api/journal"));

  // Declining to handle it means the browser performs its own normal fetch,
  // so the screen still works — the worker simply isn't in the path.
  assert.equal(handled, false, "worker should pass the request through untouched");
  assert.equal(networkCalls, 0, "pass-through means the worker doesn't even fetch it itself");
  assert.deepEqual(sw.cachedPaths(), []);
});

// --- what IS allowed to be cached ----------------------------------------

test("caches /api/today — the one payload the offline Today screen needs", async () => {
  const sw = loadServiceWorker({ network: online });
  const { handled } = await sw.dispatchFetch(req("/api/today"));

  assert.equal(handled, true);
  assert.deepEqual(sw.cachedPaths(), ["/api/today"]);
});

test("serves the cached /api/today when the network is gone", async () => {
  let fail = false;
  const sw = loadServiceWorker({
    network: async (request) => {
      if (fail) throw new TypeError("Failed to fetch");
      return ok('{"state":"ready","dayNumber":12}');
    },
  });

  await sw.dispatchFetch(req("/api/today")); // warm the cache
  fail = true;

  const { response } = await sw.dispatchFetch(req("/api/today"));
  assert.ok(response, "offline request must be answered from cache");
  assert.equal(JSON.parse(await response!.text()).dayNumber, 12);
});

test("an offline API call with nothing cached fails as a network error, not as HTML", async () => {
  // Answering an API call with the Today *page* would make apiFetch try to
  // JSON.parse an HTML document, producing a confusing error instead of the
  // screen's offline state.
  const sw = loadServiceWorker({ network: offline });
  const { response } = await sw.dispatchFetch(req("/api/today"));

  assert.ok(response, "respondWith must still be called");
  assert.equal(response!.type, "error", "must be a network error response");
});

// --- method and origin scoping -------------------------------------------

test("never caches a mutation, even to an allow-listed path", async () => {
  const sw = loadServiceWorker({ network: online });
  const { handled } = await sw.dispatchFetch(req("/api/today", { method: "POST" }));

  assert.equal(handled, false, "non-GET must pass straight through");
  assert.deepEqual(sw.cachedPaths(), []);
});

test("ignores cross-origin requests entirely", async () => {
  const sw = loadServiceWorker({ network: online });
  const { handled } = await sw.dispatchFetch(new Request("https://telegram.org/x.png"));

  assert.equal(handled, false);
  assert.deepEqual(sw.cachedPaths(), []);
});

test("does not cache an error response — a cached 500 would be served back offline", async () => {
  const sw = loadServiceWorker({
    network: async () => {
      const res = new Response("boom", { status: 500 });
      Object.defineProperty(res, "type", { value: "basic" });
      return res;
    },
  });

  await sw.dispatchFetch(req("/api/today"));
  assert.deepEqual(sw.cachedPaths(), []);
});

// --- cache versioning ----------------------------------------------------

test("activate deletes caches from older versions", async () => {
  // This is what evicts the previously-leaked private data from existing
  // installs: the cache name changed, so the old store is dropped on
  // activation rather than lingering with a diary in it.
  const listeners = new Map<string, (event: unknown) => void>();
  const { api: caches, stores } = makeCacheStorage();
  await (await caches.open("nevidimka-shell-v1")).put(req("/api/journal"), ok());
  assert.equal(stores.size, 1, "precondition: a stale v1 cache exists");

  const self = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler);
    },
    skipWaiting() {},
    clients: { claim() {} },
    location: { origin: ORIGIN },
    registration: {},
  };
  const fn = new Function("self", "caches", "fetch", "Response", "URL", `"use strict";${SW_SOURCE}`);
  fn(self, caches, online, Response, URL);

  const activate = listeners.get("activate");
  assert.ok(activate, "sw.js must register an activate listener");

  const waits: Promise<unknown>[] = [];
  activate!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);

  assert.ok(
    !stores.has("nevidimka-shell-v1"),
    "the old cache — holding leaked private data — must be deleted on activate"
  );
});
