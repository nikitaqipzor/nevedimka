import { z } from "zod";

export const DayPlannerOutputSchema = z.union([
  z.object({
    summary: z.string(),
    main_task: z.object({
      title: z.string(),
      estimate_minutes: z.number().int().positive(),
      direction: z.string().nullable(),
    }),
    additional_tasks: z
      .array(
        z.object({
          title: z.string(),
          estimate_minutes: z.number().int().positive(),
          direction: z.string().nullable(),
        })
      )
      .max(2),
    reasoning_note: z.string(),
  }),
  z.object({ error: z.literal("no_active_mission") }),
]);
export type DayPlannerOutput = z.infer<typeof DayPlannerOutputSchema>;

export const MultiMissionDayPlannerOutputSchema = z.union([
  z.object({
    plans: z
      .array(
        z.object({
          mission_id: z.string(),
          summary: z.string(),
          main_task: z.object({
            title: z.string(),
            estimate_minutes: z.number().int().positive(),
            direction: z.string().nullable(),
          }),
          reasoning_note: z.string(),
        })
      )
      .min(1)
      .refine((plans) => plans.length === new Set(plans.map((p) => p.mission_id)).size, {
        message: "duplicate mission_id in plans array",
      }),
  }),
  z.object({ error: z.literal("no_active_mission") }),
]);
export type MultiMissionDayPlannerOutput = z.infer<typeof MultiMissionDayPlannerOutputSchema>;

export const ActionCoachOutputSchema = z.object({
  first_step: z.string(),
  subtasks: z.array(z.string()).max(5),
  note: z.string().optional(),
});
export type ActionCoachOutput = z.infer<typeof ActionCoachOutputSchema>;

export const ResultReviewerOutputSchema = z.object({
  completion_percent: z.number().int().min(0).max(100).nullable(),
  comment: z.string(),
  needs_clarification: z.boolean(),
});
export type ResultReviewerOutput = z.infer<typeof ResultReviewerOutputSchema>;

export const StrategistOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  milestones: z
    .array(
      z.object({
        title: z.string(),
        target_day: z.number().int().positive(),
      })
    )
    .min(1)
    .max(5),
});
export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;

export const MentorChatOutputSchema = z.object({
  reply: z.string(),
});
export type MentorChatOutput = z.infer<typeof MentorChatOutputSchema>;

export const TextEditorOutputSchema = z.object({
  gentle: z.string(),
  structured: z.string(),
  short: z.string(),
});
export type TextEditorOutput = z.infer<typeof TextEditorOutputSchema>;

export const PrivacyGuardOutputSchema = z.object({
  flags: z.array(
    z.object({
      type: z.enum(["personal_data", "unconfirmed_claim"]),
      excerpt: z.string(),
      note: z.string(),
    })
  ),
});
export type PrivacyGuardOutput = z.infer<typeof PrivacyGuardOutputSchema>;

export const BehaviorAnalystOutputSchema = z.object({
  observations: z.array(z.string()).max(3),
});
export type BehaviorAnalystOutput = z.infer<typeof BehaviorAnalystOutputSchema>;

export const SkillsMentorOutputSchema = z.object({
  guidance: z
    .array(
      z.object({
        direction: z.string(),
        note: z.string(),
      })
    )
    .max(5),
});
export type SkillsMentorOutput = z.infer<typeof SkillsMentorOutputSchema>;
