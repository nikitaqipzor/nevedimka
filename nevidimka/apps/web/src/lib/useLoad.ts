"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./apiClient";

export type LoadState = "loading" | "ready" | "error" | "offline";

/**
 * Classifies a thrown load failure into the state and message the user sees.
 *
 * Extracted from the hook so it is directly testable without a React
 * renderer: this is the part with actual decisions in it, and it is what
 * distinguishes "нет сети" from "что-то сломалось".
 *
 * An ApiError means the server answered — the request reached it and came
 * back with a code, so whatever went wrong, it is not connectivity. Anything
 * else reaching here is a network-layer failure: fetch rejects with TypeError
 * when it cannot reach the origin, and the service worker returns
 * Response.error() for an uncacheable API call while offline (which apiFetch
 * also surfaces as a TypeError).
 *
 * navigator.onLine only picks between two wordings. It is never the primary
 * test, because it reports link state, not reachability — it is true on a
 * captive-portal wifi or a dead uplink. So a real network failure with
 * onLine === true is still reported as an error, just with generic wording.
 */
export function classifyLoadError(
  err: unknown,
  isOnline: boolean
): { state: Extract<LoadState, "error" | "offline">; error: string } {
  if (err instanceof ApiError) {
    return { state: "error", error: err.message };
  }
  return isOnline
    ? { state: "error", error: "Не удалось загрузить данные." }
    : { state: "offline", error: "Нет сети." };
}

/**
 * Loads a screen's data and tracks the four states PROJECT_SPEC.md section
 * 11 requires for every screen: загрузка, готово, ошибка, офлайн ("пусто" is
 * data-shaped, so each screen decides that itself from the loaded value).
 *
 * Why this exists: every screen used to call apiFetch inside a bare
 * `useEffect(() => { load() }, [])` with no catch. On any failure the
 * promise rejected unhandled, the data state stayed null, and the screen
 * showed "Загрузка…" forever — with no retry and no message. Offline made
 * that the *normal* outcome, which is precisely the case the PWA is
 * supposed to handle: the service worker serves a cached /api/today when it
 * can, but every other screen just fails.
 *
 * Offline is reported separately from a generic error because the two need
 * different words to the user — "нет сети, показываем последнее" versus
 * "что-то сломалось". A TypeError from fetch (as opposed to our ApiError,
 * which means the server did answer) is the reliable signal: fetch rejects
 * with TypeError on a network-layer failure. navigator.onLine is checked as
 * a secondary hint only — it reports link state, not reachability, so it
 * cannot be the primary test.
 */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: unknown[] = []
): {
  data: T | null;
  state: LoadState;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  // `load` is intentionally not in the dep list: callers pass an inline
  // closure, which would be a new function every render and loop forever.
  // Callers control re-fetching through `deps`.
  const run = useCallback(async () => {
    try {
      const result = await load();
      setData(result);
      setState("ready");
      setError(null);
    } catch (err) {
      const isOnline = typeof navigator === "undefined" || navigator.onLine;
      const classified = classifyLoadError(err, isOnline);
      setState(classified.state);
      setError(classified.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, state, error, reload: run };
}
