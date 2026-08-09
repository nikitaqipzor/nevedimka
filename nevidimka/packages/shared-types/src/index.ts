// Shared domain types for the "Nevidimka" system.
// Release 1 scope: users, missions, milestones, daily plans, tasks,
// focus sessions, evidences, ideas, ai_logs.
// Mirrors PROJECT_SPEC.md section 12 (Data model).

export type UUID = string;
export type ISODateString = string; // YYYY-MM-DD
export type ISODateTimeString = string; // full ISO 8601 timestamp

export type ProgramLength = 180 | 365;

export interface User {
  id: UUID;
  telegramId: string;
  username?: string;
  firstName?: string;
  day0Date: ISODateString;
  programLength: ProgramLength;
  timezone: string; // IANA tz, e.g. "Europe/Amsterdam"
  reminderHourMorning?: number; // 0-23, local time
  reminderHourEvening?: number;
  channelId?: string; // per-user connected Telegram channel; falls back to TELEGRAM_CHANNEL_ID env var when unset
  createdAt: ISODateTimeString;
}

export type MissionStatus = "draft" | "active" | "completed" | "abandoned";

export interface Mission {
  id: UUID;
  userId: UUID;
  title: string;
  description?: string;
  directions: string[]; // e.g. ["Создание", "Тело", "Смелость"]
  commitmentText: string; // "договор с собой"
  status: MissionStatus;
  createdAt: ISODateTimeString;
}

export type MilestoneStatus = "planned" | "in_progress" | "done" | "skipped";

export interface Milestone {
  id: UUID;
  missionId: UUID;
  title: string;
  targetDay: number; // day-of-program this milestone targets
  status: MilestoneStatus;
  createdAt: ISODateTimeString;
}

export interface DailyCheckIn {
  sleepQuality?: number; // 1-5
  energy?: number; // 1-5
  mood?: number; // 1-5
  stress?: number; // 1-5
  note?: string;
}

export interface DailyPlan {
  id: UUID;
  userId: UUID;
  date: ISODateString;
  dayNumber: number; // day N of the program
  checkIn?: DailyCheckIn;
  mainTaskId?: UUID;
  additionalTaskIds: UUID[];
  aiSummary?: string; // the "Никита, день 12 из 180..." style text
  eveningReviewNote?: string;
  createdAt: ISODateTimeString;
}

export type TaskStatus =
  | "planned"
  | "in_progress"
  | "done"
  | "partially_done"
  | "postponed"
  | "cancelled";

export interface Task {
  id: UUID;
  userId: UUID;
  missionId?: UUID;
  dailyPlanId?: UUID;
  title: string;
  isMainTask: boolean;
  status: TaskStatus;
  direction?: string; // one of Mission.directions, set by the day planner
  estimateMinutes?: number;
  actualMinutes?: number;
  completionPercent?: number; // 0-100, set by Reviewer role
  postponedCount: number;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface FocusSession {
  id: UUID;
  userId: UUID;
  taskId?: UUID;
  startedAt: ISODateTimeString;
  endedAt?: ISODateTimeString;
  durationSeconds?: number;
  wasInterrupted: boolean;
}

export type EvidenceKind = "text" | "voice" | "video";

export interface Evidence {
  id: UUID;
  userId: UUID;
  taskId?: UUID;
  kind: EvidenceKind;
  storagePath: string; // path in private storage bucket
  transcript?: string; // filled for voice/video after ASR
  rawText?: string; // for kind === "text"
  createdAt: ISODateTimeString;
}

export type IdeaStatus = "inbox" | "converted_to_task" | "archived";

export interface Idea {
  id: UUID;
  userId: UUID;
  text: string;
  status: IdeaStatus;
  createdAt: ISODateTimeString;
}

export type AiRole =
  | "orchestrator"
  | "strategist"
  | "day_planner"
  | "action_coach"
  | "behavior_analyst"
  | "result_reviewer"
  | "skills_mentor"
  | "text_editor"
  | "video_editor"
  | "privacy_guard"
  | "publication_packer"
  | "publisher";

export interface AiLog {
  id: UUID;
  userId: UUID;
  role: AiRole;
  input: unknown;
  output: unknown;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  createdAt: ISODateTimeString;
}

// --- Release 2 (Mini App) additions ----------------------------------------

export interface SkillProgress {
  direction: string;
  totalTasks: number;
  doneTasks: number;
  completionPercent: number; // 0-100, rounded
}

export interface AnalyticsSummary {
  periodDays: number;
  tasksPlanned: number;
  tasksDone: number;
  completionRate: number; // 0-100
  postponedCount: number;
  focusMinutesTotal: number;
  focusSessionCount: number;
  averageSleep?: number;
  averageEnergy?: number;
  averageMood?: number;
  averageStress?: number;
}

export type MentorMessageRole = "user" | "assistant";

export interface MentorMessage {
  id: UUID;
  userId: UUID;
  role: MentorMessageRole;
  content: string;
  createdAt: ISODateTimeString;
}

export interface MilestoneView extends Omit<Milestone, "status"> {
  /** "current" and "passed" are computed for display, never stored: a
   *  passed target_day does not by itself mean the milestone was actually
   *  completed, so we don't relabel it "done" without real confirmation. */
  status: MilestoneStatus | "current" | "passed";
}

// --- Release 3 (publication pipeline) --------------------------------------

export type ContentDraftStatus =
  | "draft"
  | "editing"
  | "ready_for_review"
  | "confirmed"
  | "publishing"
  | "published"
  | "failed";

export type ContentVersionStep = "original" | "gentle" | "structured" | "short" | "final";

export interface PrivacyFlag {
  type: "personal_data" | "unconfirmed_claim";
  excerpt: string;
  note: string;
}

export interface ContentDraft {
  id: UUID;
  userId: UUID;
  sourceEvidenceId?: UUID;
  sourceText: string;
  status: ContentDraftStatus;
  chosenVersionId?: UUID;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface ContentVersion {
  id: UUID;
  draftId: UUID;
  userId: UUID;
  step: ContentVersionStep;
  text: string;
  privacyFlags?: PrivacyFlag[];
  createdAt: ISODateTimeString;
}

export type PublicationStatus = "pending" | "published" | "edited" | "deleted" | "failed";

export interface Publication {
  id: UUID;
  userId: UUID;
  draftId?: UUID;
  contentVersionId?: UUID;
  videoAssetId?: UUID;
  videoRenderId?: UUID;
  channelId: string;
  telegramMessageId?: number;
  publishedHtml: string;
  editedHtml?: string;
  editedAt?: ISODateTimeString;
  status: PublicationStatus;
  errorMessage?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

// --- Release 4 (video pipeline) ---------------------------------------------

export type VideoAssetStatus =
  | "uploaded"
  | "processing"
  | "preview_ready"
  | "confirmed"
  | "rendering"
  | "published"
  | "cancelled"
  | "failed";

export interface VideoAsset {
  id: UUID;
  userId: UUID;
  sourceEvidenceId?: UUID;
  originalStoragePath: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  status: VideoAssetStatus;
  errorMessage?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface VideoCutRecord {
  start: number;
  end: number;
  reason: string;
}

export type VideoCutPlanSource = "silence_detection" | "ai_semantic";

export interface VideoCutPlan {
  id: UUID;
  videoAssetId: UUID;
  userId: UUID;
  cuts: VideoCutRecord[];
  source: VideoCutPlanSource;
  createdAt: ISODateTimeString;
}

export type VideoRenderKind = "preview" | "final";

export interface VideoRender {
  id: UUID;
  videoAssetId: UUID;
  userId: UUID;
  kind: VideoRenderKind;
  storagePath: string;
  coverPath?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  createdAt: ISODateTimeString;
}

// --- Shared input validation -------------------------------------------

/**
 * Character limits for free-form user text, enforced identically by both
 * apps/bot and apps/web (see validateTextLength below). Without these,
 * nothing bounds how much text gets sent to an AI role per call — a cost
 * and abuse surface with zero protection until this was added.
 */
export const MAX_TEXT_LENGTH = {
  ideaText: 2000,
  reportText: 4000,
  mentorMessage: 2000,
  postSourceText: 8000,
  onboardingText: 4000,
  actionCoachNote: 1000,
  eveningReviewNote: 2000,
} as const;

export type TextLengthField = keyof typeof MAX_TEXT_LENGTH;

/**
 * Returns an error message if `text` exceeds the named field's limit, or
 * null if it's fine. Callers should reject with a clear message rather
 * than silently truncating — truncation surprises people when their entry
 * doesn't say what they thought they submitted.
 */
export function validateTextLength(field: TextLengthField, text: string): string | null {
  const max = MAX_TEXT_LENGTH[field];
  if (text.length > max) {
    return `Слишком длинный текст (${text.length} символов, максимум ${max}). Сократи и попробуй снова.`;
  }
  if (text.trim().length === 0) {
    return "Текст не может быть пустым.";
  }
  return null;
}
