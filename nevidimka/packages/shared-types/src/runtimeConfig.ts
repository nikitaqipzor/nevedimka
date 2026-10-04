export type RuntimeService = "bot" | "web" | "worker";
export type RuntimeEnvironment = Record<string, string | undefined>;

export function isOwnerTelegramId(id: string, env: RuntimeEnvironment = process.env): boolean {
  const owner = env.OWNER_TELEGRAM_ID?.trim();
  if (!owner) return env.NODE_ENV !== "production";
  return id === owner;
}

/** Validate before serving requests or starting jobs; errors never include values. */
export function validateRuntimeEnvironment(service: RuntimeService, env: RuntimeEnvironment = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const errors: string[] = [];
  const required = ["DATABASE_URL", "SYSTEM_DATABASE_URL", "TELEGRAM_BOT_TOKEN", "OWNER_TELEGRAM_ID", "VIDEO_STORAGE_ROOT"];
  if (service !== "worker") required.push("EVIDENCE_STORAGE_ROOT", "ANTHROPIC_API_KEY");
  if (service === "web") required.push("JWT_SECRET", "APP_BASE_URL");
  for (const name of required) {
    const value = env[name]?.trim();
    if (!value || /your-key|your-password|your-project|your-domain\.example\.com|placeholder|examplebottoken/i.test(value)) errors.push(`${name} must be configured`);
  }
  if (!/^[1-9]\d*$/.test(env.OWNER_TELEGRAM_ID?.trim() ?? "")) errors.push("OWNER_TELEGRAM_ID must be a positive numeric ID");
  if (env.ALLOW_DEV_AUTH === "true") errors.push("ALLOW_DEV_AUTH is forbidden in production");
  for (const name of ["TELEGRAM_API_BASE_URL", "ANTHROPIC_API_BASE_URL", "ASR_API_BASE_URL"]) {
    if (env[name]?.trim()) errors.push(`${name} is a test-only override`);
  }
  if (service === "web" && (env.JWT_SECRET?.trim().length ?? 0) < 32) errors.push("JWT_SECRET must contain at least 32 characters");
  for (const name of service === "web" ? ["APP_BASE_URL"] : []) {
    try { if (new URL(env[name] ?? "").protocol !== "https:") errors.push(`${name} must use HTTPS`); }
    catch { errors.push(`${name} must be a valid URL`); }
  }
  const webhook = env.TELEGRAM_WEBHOOK_URL?.trim();
  if (service === "bot" && webhook) {
    try { if (new URL(webhook).protocol !== "https:" || webhook.includes("your-domain.example.com")) errors.push("TELEGRAM_WEBHOOK_URL must be a real HTTPS URL"); }
    catch { errors.push("TELEGRAM_WEBHOOK_URL must be a valid URL"); }
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET ?? "")) errors.push("TELEGRAM_WEBHOOK_SECRET must contain 32-256 allowed characters");
  }
  for (const [name, fallback] of [
    ["PORT", "3000"], ["WORKER_POLL_INTERVAL_MS", "5000"], ["WORKER_STALE_JOB_MINUTES", "15"],
    ["WORKER_MAX_JOB_ATTEMPTS", "3"], ["AI_RATE_LIMIT_WINDOW_MINUTES", "60"], ["AI_RATE_LIMIT_MAX_CALLS", "40"],
  ]) {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || (name === "PORT" && value > 65535)) errors.push(`${name} must be a positive integer within range`);
  }
  if (errors.length) throw new Error(`Invalid production configuration: ${errors.join("; ")}`);
}
