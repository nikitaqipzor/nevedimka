import { NextRequest, NextResponse } from "next/server";
import {
  addContentVersion,
  createTextPublication,
  getActiveMissions,
  getContentDraft,
  getContentVersion,
  getPublicationByDraftId,
  getUserById,
  listContentVersions,
  logAiCall,
  markPublicationFailed,
  markPublicationSent,
  setChosenVersion,
  setContentVersionPrivacyFlags,
  updateDraftStatus,
} from "@nevidimka/db";
import { AiRateLimitExceededError, checkPrivacy } from "@nevidimka/ai";
import { validateTextLength, type Mission } from "@nevidimka/shared-types";
import { formatChannelPost, sendChannelMessage, TelegramApiError } from "@nevidimka/telegram";
import { requireSession } from "@/lib/session";
import { dayNumberFor, todayInTimezone } from "@/lib/dates";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const draft = await getContentDraft(session.userId, id);
  if (!draft) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const [versions, publication] = await Promise.all([
    listContentVersions(session.userId, id),
    getPublicationByDraftId(session.userId, id),
  ]);

  return NextResponse.json({ draft, versions, publication });
}

type ContentAction =
  | { action: "finalize"; text: string }
  | { action: "publish"; missionId?: string }
  | { action: "cancel" };

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;
  const { id: draftId } = await params;

  const body = (await req.json().catch(() => null)) as ContentAction | null;
  if (!body?.action) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "missing action" }, { status: 400 });
  }

  switch (body.action) {
    case "finalize": {
      const text = body.text?.trim();
      if (!text) {
        return NextResponse.json({ code: "BAD_REQUEST", message: "text is required" }, { status: 400 });
      }
      const lengthError = validateTextLength("postSourceText", text);
      if (lengthError) {
        return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
      }
      const finalVersion = await addContentVersion({ userId, draftId, step: "final", text });
      await setChosenVersion(userId, draftId, finalVersion.id);

      let privacyResult: Awaited<ReturnType<typeof checkPrivacy>>;
      try {
        privacyResult = await checkPrivacy({ text }, userId);
      } catch (err) {
        if (err instanceof AiRateLimitExceededError) {
          return NextResponse.json(
            { code: "AI_RATE_LIMIT_EXCEEDED", message: err.message },
            { status: 429 }
          );
        }
        throw err;
      }
      const { output, tokensIn, tokensOut, costUsd } = privacyResult;
      await logAiCall({
        userId,
        role: "privacy_guard",
        input: { draftId },
        output,
        tokensIn,
        tokensOut,
        costUsd,
      });
      const versionWithFlags = await setContentVersionPrivacyFlags(userId, finalVersion.id, output.flags);

      return NextResponse.json({ ok: true, version: versionWithFlags });
    }

    case "publish": {
      // Content drafts (see ContentDraft in packages/shared-types) don't carry
      // a missionId of their own — a draft is created from freeform evidence
      // text with no mission context at all, so there's no existing per-draft
      // attribution to fall back on (same finding as apps/bot/src/handlers/
      // content.ts's equivalent publish flow). With multi-active-goals a
      // single user can have more than one mission with status "active" at
      // publish time, so which mission's day-N counter/program length the
      // post header should use is genuinely ambiguous and has to be resolved
      // explicitly:
      //   - 0 active missions: nothing to attribute to, refuse to publish.
      //   - 1 active mission: no ambiguity, publish straight through.
      //   - 2+ active missions: this is a web API, not a chat interface, so
      //     there's no inline keyboard to show — instead require the caller
      //     to pass an explicit missionId in the request body, and reject
      //     with a 4xx (including the list of active missions) if it's
      //     missing or doesn't match an active mission. Building the actual
      //     picker UI that supplies this missionId is out of scope here.
      //
      // A future migration adding a mission_id column to content_drafts (set
      // at creation time) would remove this ambiguity entirely — out of
      // scope per CLAUDE.md's migration-approval rule, flagged as a follow-up.
      const requestedMissionId =
        typeof body.missionId === "string" && body.missionId.trim() ? body.missionId : undefined;

      const [user, missions] = await Promise.all([getUserById(userId), getActiveMissions(userId)]);
      if (!user) {
        return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
      }
      if (missions.length === 0) {
        return NextResponse.json(
          {
            code: "NO_ACTIVE_MISSION",
            message: "Нет активной цели — не к чему привязать пост.",
          },
          { status: 422 }
        );
      }

      let mission: Mission | undefined = missions.length === 1 ? missions[0] : undefined;
      if (!mission) {
        if (!requestedMissionId) {
          return NextResponse.json(
            {
              code: "MISSION_ID_REQUIRED",
              message: "Активно несколько целей — укажите missionId в теле запроса.",
              missions: missions.map((m) => ({ id: m.id, title: m.title })),
            },
            { status: 400 }
          );
        }
        mission = missions.find((m) => m.id === requestedMissionId);
        if (!mission) {
          return NextResponse.json(
            {
              code: "MISSION_NOT_ACTIVE",
              message: "Указанная цель не найдена среди активных.",
              missions: missions.map((m) => ({ id: m.id, title: m.title })),
            },
            { status: 400 }
          );
        }
      }

      const channelId = user.channelId ?? process.env.TELEGRAM_CHANNEL_ID;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!channelId || !botToken) {
        return NextResponse.json({ code: "CHANNEL_NOT_CONFIGURED" }, { status: 422 });
      }

      const draft = await getContentDraft(userId, draftId);
      if (!draft || !draft.chosenVersionId) {
        return NextResponse.json({ code: "DRAFT_NOT_READY" }, { status: 422 });
      }
      if (draft.status === "publishing" || draft.status === "published") {
        return NextResponse.json(
          {
            code: "ALREADY_PUBLISHING",
            message: "Публикация уже выполняется или уже завершена для этого черновика.",
          },
          { status: 409 }
        );
      }
      const version = await getContentVersion(userId, draft.chosenVersionId);
      if (!version) {
        return NextResponse.json({ code: "VERSION_NOT_FOUND" }, { status: 404 });
      }

      const today = todayInTimezone(user.timezone);
      const dayNumber = dayNumberFor(mission.day0Date, today);
      const html = formatChannelPost({
        dayNumber,
        programLength: mission.programLength,
        text: version.text,
      });

      await updateDraftStatus(userId, draftId, "publishing");
      const publication = await createTextPublication({
        userId,
        draftId,
        contentVersionId: version.id,
        channelId,
        publishedHtml: html,
      });

      try {
        const result = await sendChannelMessage({ botToken }, channelId, html);
        const sent = await markPublicationSent(userId, publication.id, result.messageId);
        await updateDraftStatus(userId, draftId, "published");
        return NextResponse.json({ ok: true, publication: sent });
      } catch (err) {
        const message = err instanceof TelegramApiError ? err.message : "unknown error";
        await markPublicationFailed(userId, publication.id, message);
        await updateDraftStatus(userId, draftId, "failed");
        return NextResponse.json(
          { code: "PUBLISH_FAILED", message },
          { status: 502 }
        );
      }
    }

    case "cancel": {
      const draft = await updateDraftStatus(userId, draftId, "failed");
      return NextResponse.json({ ok: true, draft });
    }

    default:
      return NextResponse.json({ code: "BAD_REQUEST", message: "unknown action" }, { status: 400 });
  }
}
