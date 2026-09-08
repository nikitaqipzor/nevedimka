import Anthropic from "@anthropic-ai/sdk";
import { assertAiRateLimit } from "./rateLimit.js";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({
      apiKey,
      baseURL: process.env.ANTHROPIC_API_BASE_URL || undefined,
    });
  }
  return client;
}

export interface CallRoleResult {
  raw: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Thrown when a role's response fails JSON parsing or schema validation
 * AFTER the Anthropic API call already succeeded (and was billed). Carries
 * the already-known cost data so a caller can still log the spend to
 * ai_logs instead of losing it silently — see roles.ts.
 */
export class AiResponseParseError extends Error {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly raw: string;

  constructor(
    message: string,
    params: { tokensIn: number; tokensOut: number; costUsd: number; raw: string; cause?: unknown }
  ) {
    super(message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = "AiResponseParseError";
    this.tokensIn = params.tokensIn;
    this.tokensOut = params.tokensOut;
    this.costUsd = params.costUsd;
    this.raw = params.raw;
  }
}

/**
 * Rough per-million-token pricing (USD) for cost tracking in ai_logs —
 * NOT used for billing, just an internal estimate so
 * ai_logs.cost_usd stops being permanently NULL (see AUDIT_REPORT.md).
 *
 * Rates verified against Anthropic's published pricing 2026-08-27. Two
 * entries were wrong before that check: claude-sonnet-5 was listed at the
 * Sonnet-4.6 rate (3/15 instead of 2/10), and claude-opus-4-8 at 15/75 —
 * triple its actual 5/25 — so every Opus call's cost_usd was overstated 3x.
 *
 * Anthropic's published pricing changes over time; check
 * https://docs.claude.com for current rates and update this table
 * alongside AI_MODEL in .env.example if they drift apart.
 */
const PRICING_PER_MILLION_TOKENS: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  // The dated alias AI_MODEL used to be able to carry. Same model, same rates.
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
// Sonnet-5 rates: the configured default in .env.example. Deliberately the
// cheapest current tier rather than a mid-range guess, so an unrecognised
// model under-reports rather than silently inflating cost_usd.
const DEFAULT_PRICING = { in: 2, out: 10 };

/**
 * Exported for testing: this is a money figure that lands in
 * ai_logs.cost_usd, and two of the rates in the table above were silently
 * wrong before anyone checked them against published pricing.
 */
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = PRICING_PER_MILLION_TOKENS[model] ?? DEFAULT_PRICING;
  return (tokensIn / 1_000_000) * pricing.in + (tokensOut / 1_000_000) * pricing.out;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // The SDK itself wraps genuine fetch-layer failures (DNS, ECONNRESET,
    // timeouts, etc.) as APIConnectionError/APIConnectionTimeoutError with
    // `status: undefined` before they ever reach us — those are
    // transient and worth retrying regardless of status.
    if (err instanceof Anthropic.APIConnectionError) return true;
    // 429 (rate limit), 500/502/503 (server-side), 529 (overloaded) are
    // worth retrying; 400/401/403/404 are not — retrying a bad request
    // just fails the same way three times slower.
    return err.status === 429 || err.status === 529 || (err.status ?? 0) >= 500;
  }
  // Any other Error (e.g. a plain Error thrown by our own code, like a
  // missing API key or a missing text block) is a config/logic failure,
  // not a network blip — retrying it just fails identically 3 more times.
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the model with a role's system prompt and a JSON-serializable
 * input payload, expecting a JSON-only response (each prompts/*.md file
 * specifies the exact schema). Does not parse/validate — callers pair this
 * with a zod schema from schemas.ts.
 *
 * Retries transient failures (rate limits, overload, 5xx, network errors)
 * with exponential backoff. Does not retry client errors (bad request,
 * auth, not found) — those fail the same way every time.
 *
 * If `userId` is provided, enforces the AI rate limit (see rateLimit.ts)
 * before making the call — deliberately a separate top-level param, not
 * folded into `input`, so it's never part of the JSON sent to Claude.
 */
export async function callRole(params: {
  systemPrompt: string;
  input: unknown;
  maxTokens?: number;
  userId?: string;
}): Promise<CallRoleResult> {
  if (params.userId) {
    await assertAiRateLimit(params.userId);
  }

  const model = process.env.AI_MODEL ?? "claude-sonnet-5";

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().messages.create({
        model,
        max_tokens: params.maxTokens ?? 1024,
        system: params.systemPrompt,
        messages: [
          {
            role: "user",
            content: JSON.stringify(params.input),
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("AI role response contained no text block");
      }

      const tokensIn = response.usage.input_tokens;
      const tokensOut = response.usage.output_tokens;
      return {
        raw: textBlock.text,
        tokensIn,
        tokensOut,
        costUsd: estimateCostUsd(model, tokensIn, tokensOut),
      };
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      console.warn(
        `[ai] role call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms:`,
        (err as Error).message
      );
      await sleep(delay);
    }
  }
  // Unreachable — the loop above always either returns or throws — but
  // keeps tsc happy about all code paths returning.
  throw lastErr;
}

/**
 * Strips a Markdown code fence (```json, plain ```, or any other language
 * tag) around an LLM response before JSON.parse, tolerating leading/trailing
 * prose around the fence. If no fence is found (or the unfenced text still
 * doesn't parse), falls back to extracting the first balanced {...}/[...]
 * region so a stray leading/trailing sentence doesn't cause a hard failure.
 */
export function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
  const candidate = (fenceMatch ? fenceMatch[1] : trimmed).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const extracted = extractBalancedJson(trimmed);
    if (extracted !== null) {
      return JSON.parse(extracted) as T;
    }
    throw new SyntaxError(`AI role response was not valid JSON: ${raw.slice(0, 200)}`);
  }
}

/** Finds the first balanced {...} or [...] substring, respecting quoted strings. */
function extractBalancedJson(text: string): string | null {
  const startIdx = text.search(/[{[]/);
  if (startIdx === -1) return null;
  const open = text[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}
