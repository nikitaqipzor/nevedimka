const CACHE_NAME = "nevidimka-shell-v2";
const SHELL_URLS = ["/today", "/manifest.json", "/icons/icon-192.png"];

/**
 * The ONLY API response allowed into the cache.
 *
 * PROJECT_SPEC.md section 6 asks for an offline copy of the last successful
 * "Сегодня" state, and section 15 requires diaries and videos to stay
 * private. This service worker used to cache every successful GET, which
 * quietly wrote far more than the Today screen into the browser's Cache
 * Storage — /api/journal (the whole diary), /api/settings/export (a full
 * data export), /api/analytics, /api/mentor (chat history), and
 * /api/video/[id]/file (entire video files, which also blows through the
 * cache quota). Cache Storage is origin-scoped, unencrypted, and survives
 * logout, so on a shared or lost device that data stayed readable without
 * a session.
 *
 * Allow-list, not deny-list: a new private endpoint must be opted IN
 * deliberately, so adding a route can't silently start caching diary data.
 */
const CACHEABLE_API_PATHS = ["/api/today"];

function isCacheableApiRequest(url) {
  return CACHEABLE_API_PATHS.some(
    (path) => url.pathname === path || url.pathname.startsWith(`${path}?`)
  );
}

/** Page navigations we keep an offline copy of — the Today screen only. */
function isCacheableNavigation(request, url) {
  return request.mode === "navigate" && (url.pathname === "/today" || url.pathname === "/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first, falling back to the last cached copy when offline — but
// only for the Today screen, its API payload, and the static shell. Never
// caches POST/PUT/DELETE (mutations, including the publish-confirmation
// flow, must never be served from a stale cache) and never caches any other
// API response (see CACHEABLE_API_PATHS above).
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin requests are none of this worker's business.
  if (url.origin !== self.location.origin) return;

  const isApi = url.pathname.startsWith("/api/");
  const mayCache = isApi
    ? isCacheableApiRequest(url)
    : isCacheableNavigation(request, url) || SHELL_URLS.includes(url.pathname);

  if (!mayCache) {
    // Still serve it, just never store it. Falling through without calling
    // respondWith would also work, but being explicit keeps the intent
    // obvious to the next reader.
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only store real successes: caching an opaque or error response
        // would serve that failure back while offline.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // An offline navigation with nothing cached for that exact URL
          // still gets the Today shell; an offline API call must NOT be
          // answered with an HTML page, so it fails as a network error and
          // the page renders its own offline state.
          return isApi ? Response.error() : caches.match("/today");
        })
      )
  );
});
