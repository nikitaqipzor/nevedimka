import pino from "pino";

/**
 * One structured logger per process (bot/worker/web each call this once
 * with their own service name). Replaces the console.log/console.error
 * calls that were scattered through the codebase with no level, no
 * structure, and no way to tell "expected operational noise" apart from
 * "something is actually wrong" without reading the message text.
 *
 * Output is always JSON — deliberately, even in local dev. The problem
 * this solves is "no structure and no levels", not "doesn't look pretty
 * in a terminal"; JSON is what any real log aggregator (or even just
 * `jq`) expects, and adding a pretty-printer is one more dependency for a
 * cosmetic want, not the actual gap.
 */
export function createLogger(service: string): pino.Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.token",
        "*.password",
        "*.secret",
        "*.apiKey",
        "*.api_key",
        "botToken",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      censor: "[redacted]",
    },
  });
}

export type Logger = pino.Logger;
