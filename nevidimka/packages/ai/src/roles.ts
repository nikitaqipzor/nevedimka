import type { ZodType } from "zod";
import { logAiCall } from "@nevidimka/db";
import type { AiRole } from "@nevidimka/shared-types";
import { AiResponseParseError, callRole, parseJsonResponse, type CallRoleResult } from "./client.js";
import { loadPrompt } from "./prompts.js";
import {
  ActionCoachOutputSchema,
  BehaviorAnalystOutputSchema,
  DayPlannerOutputSchema,
  MentorChatOutputSchema,
  PrivacyGuardOutputSchema,
  ResultReviewerOutputSchema,
  SkillsMentorOutputSchema,
  StrategistOutputSchema,
  TextEditorOutputSchema,
  type ActionCoachOutput,
  type BehaviorAnalystOutput,
  type DayPlannerOutput,
  type MentorChatOutput,
  type PrivacyGuardOutput,
  type ResultReviewerOutput,
  type SkillsMentorOutput,
  type StrategistOutput,
  type TextEditorOutput,
} from "./schemas.js";

export interface RoleCallMeta {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Parses and schema-validates a role's raw response, wrapping any failure
 * (malformed JSON, schema mismatch — both realistic under truncation at low
 * maxTokens) in an AiResponseParseError. The Anthropic API call has already
 * succeeded and been billed by this point, so the error carries the cost
 * data along rather than losing it silently.
 */
function parseRoleOutput<T>(roleName: string, schema: ZodType<T>, result: CallRoleResult): T {
  try {
    return schema.parse(parseJsonResponse(result.raw));
  } catch (err) {
    throw new AiResponseParseError(
      `${roleName}: failed to parse/validate AI response: ${(err as Error).message}`,
      {
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        raw: result.raw,
        cause: err,
      }
    );
  }
}

/**
 * Records a role call that was billed by Anthropic but never produced usable
 * output, so the spend still lands in ai_logs.
 *
 * Why this lives here and not in the callers: AiResponseParseError was built
 * to carry cost data specifically so a caller could log it — but no caller
 * ever caught it. Every call site follows the same shape (catch
 * AiRateLimitExceededError, rethrow everything else, then logAiCall on the
 * success path only), so a parse failure escaped past the logging line
 * entirely. Two consequences, both silent: real Anthropic spend went
 * unrecorded, and — because assertAiRateLimit counts rows in ai_logs — a
 * role whose output keeps failing validation never counted against the rate
 * limit, so a persistently malformed response could be retried in a loop
 * without ever tripping the backstop that exists to catch exactly that.
 *
 * Logging here, at the throw site, fixes it for all nine roles at once and
 * cannot be forgotten by a future call site. Failures to log are swallowed:
 * this runs while already handling an error, and the original
 * AiResponseParseError is far more useful to the caller than a secondary
 * database error replacing it.
 */
async function logFailedRoleCall(
  role: AiRole,
  userId: string | undefined,
  input: unknown,
  result: CallRoleResult,
  reason: string
): Promise<void> {
  if (!userId) return; // no user context — nothing to attribute the spend to
  try {
    await logAiCall({
      userId,
      role,
      input,
      output: { error: "response_validation_failed", reason, raw: result.raw.slice(0, 2000) },
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    });
  } catch {
    // Deliberately ignored — see the doc comment above.
  }
}

/**
 * Wraps callRole + parseRoleOutput so a validation failure is logged to
 * ai_logs before the error propagates. Every role below goes through this.
 */
async function callAndParseRole<T>(params: {
  role: AiRole;
  schema: ZodType<T>;
  systemPrompt: string;
  input: unknown;
  maxTokens: number;
  userId?: string;
}): Promise<{ output: T } & RoleCallMeta> {
  const result = await callRole({
    systemPrompt: params.systemPrompt,
    input: params.input,
    maxTokens: params.maxTokens,
    userId: params.userId,
  });

  try {
    const output = parseRoleOutput(params.role, params.schema, result);
    return {
      output,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  } catch (err) {
    if (err instanceof AiResponseParseError) {
      await logFailedRoleCall(params.role, params.userId, params.input, result, err.message);
    }
    throw err;
  }
}

export interface DayPlannerInput {
  userFirstName: string;
  dayNumber: number;
  programLength: number;
  missionTitle: string;
  directions: string[];
  yesterdayMainTaskTitle?: string;
  yesterdayCompletionPercent?: number | null;
  checkIn: {
    sleepQuality?: number;
    energy?: number;
    mood?: number;
    stress?: number;
  };
}

export async function planDay(
  input: DayPlannerInput,
  userId: string
): Promise<{ output: DayPlannerOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "day_planner",
    schema: DayPlannerOutputSchema,
    systemPrompt: loadPrompt("day_planner"),
    input,
    maxTokens: 1024,
    userId,
  });
}

export interface ActionCoachInput {
  taskTitle: string;
  userNote?: string; // what the user said they're stuck on
}

export async function coachAction(
  input: ActionCoachInput,
  userId: string
): Promise<{ output: ActionCoachOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "action_coach",
    schema: ActionCoachOutputSchema,
    systemPrompt: loadPrompt("action_coach"),
    input,
    maxTokens: 1024,
    userId,
  });
}

export interface ResultReviewerInput {
  taskTitle: string;
  taskEstimateMinutes?: number;
  reportText: string;
}

export async function reviewEvidence(
  input: ResultReviewerInput,
  userId: string
): Promise<{ output: ResultReviewerOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "result_reviewer",
    schema: ResultReviewerOutputSchema,
    systemPrompt: loadPrompt("result_reviewer"),
    input,
    maxTokens: 1024,
    userId,
  });
}

export interface StrategistInput {
  rawGoalText: string;
  programLength: number;
  directions: string[];
}

export async function draftMission(
  input: StrategistInput,
  userId: string
): Promise<{ output: StrategistOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "strategist",
    schema: StrategistOutputSchema,
    systemPrompt: loadPrompt("strategist"),
    input,
    maxTokens: 1024,
    userId,
  });
}

export interface MentorChatInput {
  context: {
    missionTitle: string;
    dayNumber: number;
    programLength: number;
    yesterdayMainTaskTitle?: string;
    yesterdayCompletionPercent?: number | null;
    todayMainTaskTitle?: string;
    todayMainTaskStatus?: string;
  };
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
}

export async function chatWithMentor(
  input: MentorChatInput,
  userId: string
): Promise<{ output: MentorChatOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "orchestrator",
    schema: MentorChatOutputSchema,
    systemPrompt: loadPrompt("mentor_chat"),
    input,
    maxTokens: 1024,
    userId,
  });
}

export interface TextEditorInput {
  sourceText: string;
}

export async function editText(
  input: TextEditorInput,
  userId: string
): Promise<{ output: TextEditorOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "text_editor",
    schema: TextEditorOutputSchema,
    systemPrompt: loadPrompt("text_editor"),
    input,
    maxTokens: 2048,
    userId,
  });
}

export interface PrivacyGuardInput {
  text: string;
}

export async function checkPrivacy(
  input: PrivacyGuardInput,
  userId: string
): Promise<{ output: PrivacyGuardOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "privacy_guard",
    schema: PrivacyGuardOutputSchema,
    systemPrompt: loadPrompt("privacy_guard"),
    input,
    maxTokens: 1024,
    userId,
  });
}

export interface BehaviorAnalystInput {
  periodDays: number;
  completionRate: number;
  postponedCount: number;
  focusMinutesTotal: number;
  averageSleep?: number;
  averageEnergy?: number;
  averageMood?: number;
  averageStress?: number;
}

export async function analyzeBehavior(
  input: BehaviorAnalystInput,
  userId: string
): Promise<{ output: BehaviorAnalystOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "behavior_analyst",
    schema: BehaviorAnalystOutputSchema,
    systemPrompt: loadPrompt("behavior_analyst"),
    input,
    maxTokens: 512,
    userId,
  });
}

export interface SkillsMentorInput {
  skills: { direction: string; totalTasks: number; doneTasks: number; completionPercent: number }[];
}

export async function guideSkills(
  input: SkillsMentorInput,
  userId: string
): Promise<{ output: SkillsMentorOutput } & RoleCallMeta> {
  return callAndParseRole({
    role: "skills_mentor",
    schema: SkillsMentorOutputSchema,
    systemPrompt: loadPrompt("skills_mentor"),
    input,
    maxTokens: 512,
    userId,
  });
}
