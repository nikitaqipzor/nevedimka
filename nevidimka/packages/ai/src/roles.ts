import type { ZodType } from "zod";
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
  const result = await callRole({
    systemPrompt: loadPrompt("day_planner"),
    input,
    userId,
  });
  const output = parseRoleOutput("planDay", DayPlannerOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
}

export interface ActionCoachInput {
  taskTitle: string;
  userNote?: string; // what the user said they're stuck on
}

export async function coachAction(
  input: ActionCoachInput,
  userId: string
): Promise<{ output: ActionCoachOutput } & RoleCallMeta> {
  const result = await callRole({
    systemPrompt: loadPrompt("action_coach"),
    input,
    userId,
  });
  const output = parseRoleOutput("coachAction", ActionCoachOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
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
  const result = await callRole({
    systemPrompt: loadPrompt("result_reviewer"),
    input,
    userId,
  });
  const output = parseRoleOutput("reviewEvidence", ResultReviewerOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
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
  const result = await callRole({
    systemPrompt: loadPrompt("strategist"),
    input,
    userId,
  });
  const output = parseRoleOutput("draftMission", StrategistOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
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
  const result = await callRole({
    systemPrompt: loadPrompt("mentor_chat"),
    input,
    userId,
    maxTokens: 1024,
  });
  const output = parseRoleOutput("chatWithMentor", MentorChatOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
}

export interface TextEditorInput {
  sourceText: string;
}

export async function editText(
  input: TextEditorInput,
  userId: string
): Promise<{ output: TextEditorOutput } & RoleCallMeta> {
  const result = await callRole({
    systemPrompt: loadPrompt("text_editor"),
    input,
    userId,
    maxTokens: 2048,
  });
  const output = parseRoleOutput("editText", TextEditorOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
}

export interface PrivacyGuardInput {
  text: string;
}

export async function checkPrivacy(
  input: PrivacyGuardInput,
  userId: string
): Promise<{ output: PrivacyGuardOutput } & RoleCallMeta> {
  const result = await callRole({
    systemPrompt: loadPrompt("privacy_guard"),
    input,
    userId,
    maxTokens: 1024,
  });
  const output = parseRoleOutput("checkPrivacy", PrivacyGuardOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
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
  const result = await callRole({
    systemPrompt: loadPrompt("behavior_analyst"),
    input,
    userId,
    maxTokens: 512,
  });
  const output = parseRoleOutput("analyzeBehavior", BehaviorAnalystOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
}

export interface SkillsMentorInput {
  skills: { direction: string; totalTasks: number; doneTasks: number; completionPercent: number }[];
}

export async function guideSkills(
  input: SkillsMentorInput,
  userId: string
): Promise<{ output: SkillsMentorOutput } & RoleCallMeta> {
  const result = await callRole({
    systemPrompt: loadPrompt("skills_mentor"),
    input,
    userId,
    maxTokens: 512,
  });
  const output = parseRoleOutput("guideSkills", SkillsMentorOutputSchema, result);
  return { output, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd };
}
