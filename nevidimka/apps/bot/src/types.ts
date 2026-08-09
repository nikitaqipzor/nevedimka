import type { Context, SessionFlavor } from "grammy";

/**
 * `awaiting` drives a small state machine for multi-step text replies.
 * Every handler that sets `awaiting` must be matched by a branch in
 * src/index.ts's message:text router.
 */
export type AwaitingState =
  | { kind: "onboarding_commitment" }
  | { kind: "onboarding_goal" }
  | { kind: "onboarding_directions"; selected: string[] }
  | { kind: "checkin"; planId: string }
  | { kind: "report"; taskId: string }
  | { kind: "idea" }
  | { kind: "evening_review" }
  | { kind: "action_coach"; taskId: string }
  | { kind: "post_source_text" }
  | { kind: "post_custom_final"; draftId: string }
  | { kind: "video_upload" }
  | { kind: "settings_timezone" }
  | { kind: "settings_morning_hour" }
  | { kind: "settings_evening_hour" }
  | { kind: "delete_confirm" }
  | undefined;

export interface SessionData {
  userId?: string; // our internal users.id, set once resolved via getOrCreateUser
  awaiting: AwaitingState;
  onboardingDraft?: {
    commitmentText?: string;
    goalText?: string;
    programLength?: 180 | 365;
  };
  /** Holds the strategist's proposed mission between draft and /accept. */
  missionDraft?: {
    title: string;
    description: string;
    milestones: { title: string; target_day: number }[];
    directions: string[];
  };
  /** Holds the morning hour between the two /settings reminder-hour steps. */
  settingsDraft?: {
    morningHour?: number | null;
  };
}

export type BotContext = Context & SessionFlavor<SessionData>;
