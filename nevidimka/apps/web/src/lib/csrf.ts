import { NextRequest } from "next/server";

/**
 * Fetch-Metadata based same-origin check, used to stop cross-site CSRF
 * requests against state-changing API routes.
 *
 * Context: the Mini App runs inside Telegram's WebView as a cross-site
 * iframe under Telegram's own top-level origin, which forces the session
 * cookie to be `SameSite=None; Secure` (see lib/session.ts) — a stricter
 * SameSite value would break the app outright. That means the browser will
 * happily attach the session cookie to a request forged by a hostile page
 * (e.g. an auto-submitting `enctype="text/plain"` HTML form posting to one
 * of our API routes). `Sec-Fetch-Site` is the mitigation: it is set by the
 * browser on every request based on the true relationship between the
 * initiating document and the request target, and it cannot be read, set,
 * or spoofed by page JavaScript or an HTML form — unlike a custom header
 * or a body/query parameter, which a same-site-cookie-carrying cross-site
 * form CAN still send.
 *
 * Allowed values:
 *  - "same-origin": the request was initiated by a document/script on this
 *    exact origin — i.e. the Mini App's own frontend calling its own API
 *    via `fetch()`. This is the only way our frontend actually calls these
 *    routes, including from inside the cross-site iframe: Sec-Fetch-Site is
 *    computed relative to the request's initiating document and the
 *    request target, not the top-level page, so a same-origin `fetch()`
 *    issued from inside the iframe still correctly reports "same-origin".
 *  - "none": no initiating document at all (user typed the URL, used a
 *    bookmark, etc). A state-changing JSON POST can't realistically be
 *    triggered this way, so it's harmless to allow.
 *
 * Rejected:
 *  - "cross-site" / "same-site": exactly what a hostile third-party page
 *    (cross-site form CSRF) produces.
 *  - missing header entirely: every browser engine Telegram ships Mini
 *    Apps in (Chromium-based WebViews, WKWebView/Safari 16.4+, Telegram
 *    Desktop's embedded Chromium) supports Fetch Metadata, so a request
 *    that omits it is treated as untrusted rather than silently allowed.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  return secFetchSite === "same-origin" || secFetchSite === "none";
}
